"""
Vela Notification Dispatch
──────────────────────────
Sends signal-change and daily-digest alerts via Telegram and Email (Resend).
Importable from any Python script in the Vela pipeline.

Environment variables (read from ../.env):
  TELEGRAM_BOT_TOKEN   — Telegram Bot API token from @BotFather
  TELEGRAM_CHAT_ID     — Target chat/group/channel ID
  RESEND_API_KEY       — Resend.com API key
  NOTIFICATION_EMAIL   — Recipient email address
"""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import requests

# ── Env loading (mirrors backtest.py pattern) ───────────────────────────

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def _load_env() -> dict[str, str]:
    """Parse KEY=VALUE pairs from .env (no shell expansion)."""
    env: dict[str, str] = {}
    if ENV_PATH.exists():
        for line in ENV_PATH.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


_env = _load_env()

TELEGRAM_BOT_TOKEN = _env.get("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = _env.get("TELEGRAM_CHAT_ID", "")
RESEND_API_KEY = _env.get("RESEND_API_KEY", "")
NOTIFICATION_EMAIL = _env.get("NOTIFICATION_EMAIL", "")

# ── Telegram ────────────────────────────────────────────────────────────


def send_telegram(message: str) -> bool:
    """Send a Markdown message via Telegram Bot API. Returns True on success."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("  [notify] Telegram not configured, skipping")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "Markdown",
    }
    try:
        resp = requests.post(url, json=payload, timeout=10)
        if resp.status_code == 200:
            print("  [notify] Telegram ✓")
            return True
        print(f"  [notify] Telegram error {resp.status_code}: {resp.text[:200]}")
        return False
    except Exception as e:
        print(f"  [notify] Telegram exception: {e}")
        return False


# ── Email (Resend) ──────────────────────────────────────────────────────


def send_email(subject: str, body_html: str) -> bool:
    """Send an HTML email via Resend API. Returns True on success."""
    if not RESEND_API_KEY or not NOTIFICATION_EMAIL:
        print("  [notify] Email not configured, skipping")
        return False

    url = "https://api.resend.com/emails"
    payload = {
        "from": "Vela Signals <onboarding@resend.dev>",
        "to": [NOTIFICATION_EMAIL],
        "subject": subject,
        "html": body_html,
    }
    headers = {
        "Authorization": f"Bearer {RESEND_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=10)
        if resp.status_code in (200, 201):
            print("  [notify] Email ✓")
            return True
        print(f"  [notify] Email error {resp.status_code}: {resp.text[:200]}")
        return False
    except Exception as e:
        print(f"  [notify] Email exception: {e}")
        return False


# ── Message formatting ──────────────────────────────────────────────────

_EMOJI = {"green": "🟢", "red": "🔴", "grey": "⚪"}
_LABEL = {"green": "BUY", "red": "SELL", "grey": "WAIT"}


def format_signal_telegram(
    asset_symbol: str,
    signal_color: str,
    headline: str,
    summary: str = "",
    price: float | None = None,
) -> str:
    """Format a signal change as a Telegram Markdown message."""
    emoji = _EMOJI.get(signal_color, "⚪")
    label = _LABEL.get(signal_color, "WAIT")
    price_str = f" at ${price:,.0f}" if price else ""

    lines = [
        f"{emoji} *{asset_symbol}: {label}*{price_str}",
        "",
        headline,
    ]
    if summary:
        lines += ["", summary]
    lines += ["", "_Vela — Always watching_"]
    return "\n".join(lines)


def format_signal_email(
    asset_symbol: str,
    signal_color: str,
    headline: str,
    summary: str = "",
    price: float | None = None,
) -> tuple[str, str]:
    """Return (subject, html_body) for a signal change email."""
    label = _LABEL.get(signal_color, "WAIT")
    price_str = f" at ${price:,.0f}" if price else ""

    color_map = {"green": "#00D084", "red": "#FF4757", "grey": "#EBEBEB"}
    accent = color_map.get(signal_color, "#EBEBEB")

    subject = f"Vela: {asset_symbol} → {label}{price_str}"
    html = f"""\
<div style="font-family: Inter, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; background: #FFFBF5; padding: 32px; border: 3px solid #0A0A0A;">
  <div style="border-left: 4px solid {accent}; padding-left: 16px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 4px; color: #0A0A0A; font-size: 20px;">{asset_symbol}: {label}{price_str}</h2>
  </div>
  <p style="font-size: 16px; line-height: 1.6; color: #0A0A0A; margin: 0 0 12px;">{headline}</p>
  {"<p style='font-size: 14px; line-height: 1.6; color: #6B7280; margin: 0 0 12px;'>" + summary + "</p>" if summary else ""}
  <hr style="border: none; border-top: 2px solid #EBEBEB; margin: 24px 0;">
  <p style="font-size: 12px; color: #9CA3AF; margin: 0;">Vela — Always watching the markets for you</p>
</div>"""
    return subject, html


def format_digest_telegram(headline: str, summary: str) -> str:
    """Format a daily digest as a Telegram Markdown message."""
    today = datetime.now(timezone.utc).strftime("%b %d")
    lines = [
        f"📰 *Vela Daily Digest — {today}*",
        "",
        headline,
    ]
    if summary:
        lines += ["", summary]
    lines += ["", "_Vela — Always watching_"]
    return "\n".join(lines)


def format_digest_email(headline: str, summary: str) -> tuple[str, str]:
    """Return (subject, html_body) for a daily digest email."""
    today = datetime.now(timezone.utc).strftime("%b %d")
    subject = f"Vela Daily Digest — {today}"
    html = f"""\
<div style="font-family: Inter, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; background: #FFFBF5; padding: 32px; border: 3px solid #0A0A0A;">
  <h2 style="margin: 0 0 16px; color: #0A0A0A; font-size: 20px;">📰 Daily Digest — {today}</h2>
  <p style="font-size: 16px; line-height: 1.6; color: #0A0A0A; margin: 0 0 12px;">{headline}</p>
  {"<p style='font-size: 14px; line-height: 1.6; color: #6B7280; margin: 0 0 12px;'>" + summary + "</p>" if summary else ""}
  <hr style="border: none; border-top: 2px solid #EBEBEB; margin: 24px 0;">
  <p style="font-size: 12px; color: #9CA3AF; margin: 0;">Vela — Always watching the markets for you</p>
</div>"""
    return subject, html


# ── Public dispatch functions ───────────────────────────────────────────


def notify_signal_change(
    asset_symbol: str,
    signal_color: str,
    headline: str,
    summary: str = "",
    price: float | None = None,
) -> None:
    """Dispatch a signal-change notification across all configured channels."""
    print(f"  [notify] Signal change: {asset_symbol} → {_LABEL.get(signal_color, '?')}")

    tg_msg = format_signal_telegram(asset_symbol, signal_color, headline, summary, price)
    send_telegram(tg_msg)

    subject, html = format_signal_email(asset_symbol, signal_color, headline, summary, price)
    send_email(subject, html)


def notify_daily_digest(headline: str, summary: str = "") -> None:
    """Dispatch the daily market digest via all configured channels."""
    print("  [notify] Daily digest")

    tg_msg = format_digest_telegram(headline, summary)
    send_telegram(tg_msg)

    subject, html = format_digest_email(headline, summary)
    send_email(subject, html)


# ── CLI test ────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1 and sys.argv[1] == "--test":
        print("Testing notification channels...\n")
        print("Telegram:", "configured" if TELEGRAM_BOT_TOKEN else "not configured")
        print("Email:", "configured" if RESEND_API_KEY else "not configured")
        print()

        # Test signal change
        notify_signal_change(
            asset_symbol="BTC",
            signal_color="green",
            headline="Price broke above $95,000 — trend is turning up",
            summary="Strong buying pressure building across all timeframes.",
            price=95420,
        )
        print()

        # Test daily digest
        notify_daily_digest(
            headline="Markets steady as Bitcoin holds $95K support",
            summary="ETH and HYPE showing mixed signals. No major changes today.",
        )
    else:
        print("Usage: python scripts/notify.py --test")
        print("  Sends test notifications to all configured channels.")
        print()
        print("Channels:")
        print(f"  Telegram: {'✓' if TELEGRAM_BOT_TOKEN else '✗ (set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in .env)'}")
        print(f"  Email:    {'✓' if RESEND_API_KEY else '✗ (set RESEND_API_KEY + NOTIFICATION_EMAIL in .env)'}")
