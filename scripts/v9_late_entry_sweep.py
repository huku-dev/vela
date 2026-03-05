#!/usr/bin/env python3
"""
One-off script: Run late entry sweep using v9_equities as the base config
instead of V6D. Tests whether the late entry 6-bar pattern holds up with
tighter trailing stops (3%/1.5% vs 5%/2.5%).
"""
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from backtest import (
    V6D_TRAILING_BOTH,
    NAMED_CONFIGS,
    fetch_assets,
    run_late_entry_sweep,
)

# v9_equities base config
V9_EQUITIES = NAMED_CONFIGS["v9_equities"]

# Create late entry variants based on v9_equities
V9_LATE_0 = {
    **V9_EQUITIES,
    "name": "V9-EQ: No late entry (baseline)",
    "late_entry_max_bars": 0,
}

V9_LATE_1BAR = {
    **V9_EQUITIES,
    "name": "V9-EQ: Late entry 1 bar (4H)",
    "late_entry_max_bars": 1,
}

V9_LATE_2BAR = {
    **V9_EQUITIES,
    "name": "V9-EQ: Late entry 2 bars (8H)",
    "late_entry_max_bars": 2,
}

V9_LATE_3BAR = {
    **V9_EQUITIES,
    "name": "V9-EQ: Late entry 3 bars (12H)",
    "late_entry_max_bars": 3,
}

V9_LATE_6BAR = {
    **V9_EQUITIES,
    "name": "V9-EQ: Late entry 6 bars (24H)",
    "late_entry_max_bars": 6,
}

if __name__ == "__main__":
    assets = fetch_assets()
    configs = [V9_LATE_0, V9_LATE_1BAR, V9_LATE_2BAR, V9_LATE_3BAR, V9_LATE_6BAR]
    run_late_entry_sweep(assets, 730, configs, source="hyperliquid")
