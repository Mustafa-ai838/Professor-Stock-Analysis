import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import models
from .api import initialize_database, router
from .database import Base, SessionLocal, engine


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        initialize_database(db)
    yield


app = FastAPI(title="Professor Stock Analysis API", version="1.0.0", lifespan=lifespan)
allowed_origins = {
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    *(origin.strip() for origin in os.getenv("FRONTEND_URL", "").split(",") if origin.strip()),
}
for env_host in (os.getenv("RENDER_EXTERNAL_URL"), os.getenv("RAILWAY_PUBLIC_DOMAIN")):
    if env_host and env_host.strip():
        host = env_host.strip().rstrip("/")
        allowed_origins.add(host if host.startswith("http") else f"https://{host}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
logging.getLogger(__name__).info("Market data provider initialized with PSX Lens feed.")

FRONTEND_DIST_DIR = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist"
if (FRONTEND_DIST_DIR / "index.html").is_file():
    assets_dir = FRONTEND_DIST_DIR / "assets"
    if assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(assets_dir)), name="frontend-assets")

    dist_root = FRONTEND_DIST_DIR.resolve()
    index_file = dist_root / "index.html"

    @app.get("/", include_in_schema=False)
    def serve_spa_root():
        return FileResponse(index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def serve_spa(full_path: str):
        if full_path == "api" or full_path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not found")
        candidate = (dist_root / full_path).resolve()
        if candidate.is_relative_to(dist_root) and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(index_file)
