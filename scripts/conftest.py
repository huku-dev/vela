"""Pytest configuration for Vela backtest tests."""

import pytest


def pytest_configure(config):
    config.addinivalue_line(
        "markers", "slow: requires network access (Hyperliquid API)"
    )
