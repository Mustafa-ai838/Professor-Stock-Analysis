from math import sqrt


def calculate_indicators(closes: list[float]) -> dict:
    length = len(closes)

    def moving_average(period: int) -> list[float | None]:
        values: list[float | None] = [None] * length
        for index in range(period - 1, length):
            values[index] = round(sum(closes[index - period + 1:index + 1]) / period, 4)
        return values

    rsi: list[float | None] = [None] * length
    for index in range(14, length):
        changes = [closes[pos] - closes[pos - 1] for pos in range(index - 13, index + 1)]
        gains = sum(max(value, 0) for value in changes) / 14
        losses = sum(max(-value, 0) for value in changes) / 14
        rsi[index] = round(100 if losses == 0 else 100 - 100 / (1 + gains / losses), 2)

    def ema(period: int) -> list[float | None]:
        values: list[float | None] = [None] * length
        if length < period:
            return values
        current = sum(closes[:period]) / period
        values[period - 1] = round(current, 4)
        multiplier = 2 / (period + 1)
        for index in range(period, length):
            current = closes[index] * multiplier + current * (1 - multiplier)
            values[index] = round(current, 4)
        return values

    sma20 = moving_average(20)
    sma50 = moving_average(50)
    upper: list[float] = []
    lower: list[float] = []
    for index in range(length):
        window = closes[max(0, index - 19):index + 1]
        mean = sum(window) / len(window)
        deviation = sqrt(sum((value - mean) ** 2 for value in window) / len(window))
        upper.append(round(mean + 2 * deviation, 4))
        lower.append(round(mean - 2 * deviation, 4))

    fast = ema(12)
    slow = ema(26)
    macd: list[float | None] = [round(a - b, 4) if a is not None and b is not None else None for a, b in zip(fast, slow)]
    signal_values = [value if value is not None else 0 for value in macd]
    signal: list[float | None] = [None] * length
    if length >= 9:
        current = sum(signal_values[:9]) / 9
        signal[8] = round(current, 4)
        multiplier = 2 / 10
        for index in range(9, length):
            current = signal_values[index] * multiplier + current * (1 - multiplier)
            signal[index] = round(current, 4)

    return {
        "rsi": rsi,
        "sma20": sma20,
        "sma50": sma50,
        "bollinger": {"upper": upper, "lower": lower},
        "macd": macd,
        "macd_signal": signal,
        "latest_rsi": next((value for value in reversed(rsi) if value is not None), None),
        "latest_sma20": next((value for value in reversed(sma20) if value is not None), None),
    }
