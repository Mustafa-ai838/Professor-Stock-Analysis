import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env
env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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
app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(allowed_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)
logging.getLogger(__name__).info("Market data provider initialized with PSX Lens feed.")
