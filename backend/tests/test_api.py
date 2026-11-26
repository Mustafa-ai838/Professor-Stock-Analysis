import os
import tempfile
import unittest
import uuid


_database_file = tempfile.NamedTemporaryFile(prefix="psa-test-", suffix=".db", dir=".", delete=False)
_database_file.close()
os.environ["DATABASE_URL"] = f"sqlite:///{_database_file.name.replace(chr(92), '/')}"
os.environ["SECRET_KEY"] = "test-only-signing-key-not-for-production"
os.environ["DATA_PROVIDER"] = "demo"

from fastapi.testclient import TestClient

from app.main import app


class ProfessorStockApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client_context.__exit__(None, None, None)
        from app.database import engine

        engine.dispose()
        try:
            os.remove(_database_file.name)
        except FileNotFoundError:
            pass

    def test_demo_market_and_historical_indicators(self):
        health = self.client.get("/api/health")
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["data_source"], "DEMO")
        stocks = self.client.get("/api/stocks").json()
        self.assertEqual(health.json()["last_updated"], stocks["last_updated"])

        overview = self.client.get("/api/market/overview").json()
        self.assertGreaterEqual(len(overview["stocks"]), 20)
        self.assertTrue(all(stock["data_source"] == "DEMO" for stock in overview["stocks"]))

        detail = self.client.get("/api/stocks/OGDC").json()
        self.assertEqual(detail["price"], 274.5)
        self.assertIsNotNone(detail["rsi"])

        day = self.client.get("/api/stocks/OGDC/history?range=1D").json()["items"]
        five_years = self.client.get("/api/stocks/OGDC/history?range=5Y").json()["items"]
        self.assertEqual(len(day), 24)
        self.assertEqual(day[-1]["close"], detail["price"])
        self.assertGreaterEqual(len(five_years), 1200)

        indicators = self.client.get("/api/stocks/OGDC/indicators").json()
        self.assertIsNotNone(indicators["latest_rsi"])
        self.assertIsNotNone(indicators["macd"][-1])

    def test_market_responses_expose_shared_cache_freshness(self):
        first = self.client.get("/api/stocks/OGDC").json()
        second = self.client.get("/api/stocks/OGDC").json()

        self.assertIn(first["cache_status"], {"MISS", "HIT"})
        self.assertEqual(second["cache_status"], "HIT")
        self.assertIn(second["freshness_status"], {"FRESH", "STALE"})
        self.assertTrue(second["last_updated"].endswith("+00:00"))

    def test_screening_uses_server_side_filters(self):
        response = self.client.get(
            "/api/screener",
            params={
                "sector": "Banking",
                "min_price": 100,
                "max_price": 150,
                "min_rsi": 0,
                "rsi_period": "monthly",
            },
        )
        self.assertEqual(response.status_code, 200)
        items = response.json()["items"]
        self.assertTrue(items)
        self.assertTrue(all(item["sector"] == "Banking" for item in items))
        self.assertTrue(all(100 <= item["price"] <= 150 for item in items))
        self.assertTrue(all(item["rsi_monthly"] is not None for item in items))

    def test_sector_and_dividend_records_share_stock_data(self):
        sectors = self.client.get("/api/sectors?period=1M").json()["items"]
        self.assertGreaterEqual(len(sectors), 10)
        self.assertIn("Banking", {sector["name"] for sector in sectors})
        dividends = self.client.get("/api/stocks/HBL/dividends").json()["items"]
        self.assertTrue(dividends)
        self.assertTrue(all(item["source"] == "DEMO" for item in dividends))

    def test_account_watchlist_portfolio_and_preferences_persist(self):
        email = f"api-test-{uuid.uuid4().hex}@example.test"
        registration = self.client.post(
            "/api/auth/register",
            json={"email": email, "password": "temporary-test-password"},
        )
        self.assertEqual(registration.status_code, 201)
        headers = {"Authorization": f"Bearer {registration.json()['access_token']}"}

        self.assertEqual(self.client.post("/api/watchlist", headers=headers, json={"symbol": "OGDC"}).status_code, 201)
        watchlist = self.client.get("/api/watchlist", headers=headers).json()["items"]
        self.assertEqual([item["symbol"] for item in watchlist], ["OGDC"])

        self.assertEqual(
            self.client.post(
                "/api/portfolio",
                headers=headers,
                json={"symbol": "HBL", "shares": 10, "average_cost": 100},
            ).status_code,
            201,
        )
        portfolio = self.client.get("/api/portfolio", headers=headers).json()
        self.assertEqual(portfolio["invested"], 1000)
        self.assertEqual(portfolio["current_value"], 1423)

        self.client.put(
            "/api/preferences",
            headers=headers,
            json={"currency": "PKR", "email_alerts": True},
        )
        preferences = self.client.get("/api/preferences", headers=headers).json()
        self.assertTrue(preferences["email_alerts"])


if __name__ == "__main__":
    unittest.main()
