from pydantic import BaseModel, Field


class WatchlistInput(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)


class HoldingInput(BaseModel):
    symbol: str = Field(min_length=1, max_length=16)
    shares: float = Field(gt=0)
    average_cost: float = Field(gt=0)


class PreferenceInput(BaseModel):
    currency: str = Field(default="PKR", pattern="^(PKR|USD)$")
    email_alerts: bool = False
    chart_settings: str | None = None
