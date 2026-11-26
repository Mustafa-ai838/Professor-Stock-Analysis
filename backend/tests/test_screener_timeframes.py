import os
import tempfile
import unittest

from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


class ScreenerTimeframeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = tempfile.TemporaryDirectory()
        cls.prev_mode = os.environ.get("DATA_PROVIDER_MODE")
        os.environ["DATA_PROVIDER_MODE"] = "demo"
        db_url = f"sqlite:///{os.path.join(cls.temp_dir.name, 'screener_test.db')}"

        from app.api.routes import get_db, initialize_database
        from app.database.base import Base
        from app.main import app

        cls.app = app
        cls.engine = create_engine(db_url, connect_args={"check_same_thread": False})
        cls.Session = sessionmaker(bind=cls.engine, autoflush=False, autocommit=False)
        Base.metadata.create_all(bind=cls.engine)
        with cls.Session() as db:
            initialize_database(db)

        def override_get_db():
            db = cls.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = override_get_db
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.app.dependency_overrides.clear()
        cls.engine.dispose()
        if cls.prev_mode is None:
            os.environ.pop("DATA_PROVIDER_MODE", None)
        else:
            os.environ["DATA_PROVIDER_MODE"] = cls.prev_mode
        cls.temp_dir.cleanup()

    def test_screener_returns_timeframe_specific_prices_and_volumes(self):
        daily = self.client.get("/api/screener", params={"timeframe": "daily", "page_size": 50})
        weekly = self.client.get("/api/screener", params={"timeframe": "weekly", "page_size": 50})
        monthly = self.client.get("/api/screener", params={"timeframe": "monthly", "page_size": 50})

        self.assertEqual(daily.status_code, 200)
        self.assertEqual(weekly.status_code, 200)
        self.assertEqual(monthly.status_code, 200)

        d_body = daily.json()
        w_body = weekly.json()
        m_body = monthly.json()

        self.assertEqual(d_body["timeframe"], "daily")
        self.assertEqual(w_body["timeframe"], "weekly")
        self.assertEqual(m_body["timeframe"], "monthly")
        self.assertTrue(len(d_body.get("sectors", [])) > 0)

        d_by_sym = {row["symbol"]: row for row in d_body["items"]}
        w_by_sym = {row["symbol"]: row for row in w_body["items"]}
        m_by_sym = {row["symbol"]: row for row in m_body["items"]}

        sym = "OGDC"
        self.assertIn(sym, d_by_sym)
        self.assertGreater(w_by_sym[sym]["volume"], d_by_sym[sym]["volume"])
        self.assertGreater(m_by_sym[sym]["volume"], w_by_sym[sym]["volume"])
        self.assertNotEqual(w_by_sym[sym]["price"], d_by_sym[sym]["price"])
        self.assertNotEqual(m_by_sym[sym]["price"], w_by_sym[sym]["price"])

    def test_screener_rejects_invalid_timeframe(self):
        resp = self.client.get("/api/screener", params={"timeframe": "hourly"})
        self.assertEqual(resp.status_code, 422)

    def test_corporate_announcement_and_dividend_extraction(self):
        from app.services.screener_enrichment import extract_corporate_info

        div_payload = {
            "trailing_12m_dps": 12.5,
            "history": [
                {"dps": 3.25, "ex_date": "2026-05-12", "announced_date": "2026-04-29", "raw": "32.5%(iii)"},
                {"dps": 4.25, "ex_date": "2026-03-07", "announced_date": "2026-02-23", "raw": "42.5%(ii)"},
            ],
        }
        announcements = [
            {"date": "2026-11-25", "title": "Interim Cash Dividend (D-51)", "event_date": None},
            {"date": "2026-10-30", "title": "Financial Results for the Quarter Ended September 30, 2026", "event_date": None},
            {"date": "2026-11-24", "title": "Notice of Board Meeting", "event_date": "2026-12-03"},
        ]
        info = extract_corporate_info(
            symbol="OGDC",
            dividends_payload=div_payload,
            announcements=announcements,
            calendar_row=None,
            stock={"latest_dividend": 12.5},
            today_str="2026-11-25",
        )
        self.assertEqual(info["last_dividend_amount"], 3.25)
        self.assertEqual(info["last_dividend_date"], "2026-05-12")
        self.assertEqual(info["next_dividend_date"], "2026-11-25")
        self.assertEqual(info["last_earning_date"], "2026-10-30")
        self.assertEqual(info["next_earning_date"], "2026-12-03")


if __name__ == "__main__":
    unittest.main()
