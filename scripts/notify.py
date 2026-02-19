"""
Vela Notification Dispatch
──────────────────────────
Sends condensed signal-change and daily-digest alerts via Telegram and Email
(Resend) with links back to the product for the full brief.

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
from typing import Any

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

# ── Configuration ────────────────────────────────────────────────────────

# TODO: Replace with production URL before go-live
APP_BASE_URL = "http://localhost:5173"

# Telegram inline keyboard buttons require HTTPS URLs — skip buttons for localhost
_USE_INLINE_BUTTONS = APP_BASE_URL.startswith("https://")

# ── Constants ────────────────────────────────────────────────────────────

_EMOJI = {"green": "🟢", "red": "🔴", "grey": "⚪"}
_LABEL = {"green": "BUY", "red": "SELL", "grey": "WAIT"}
_ACCENT = {"green": "#00D084", "red": "#FF4757", "grey": "#EBEBEB"}

# ── Telegram ────────────────────────────────────────────────────────────


def _send_telegram_with_buttons(
    message: str, buttons: list[list[dict[str, str]]] | None = None
) -> bool:
    """Send a Markdown message with optional inline keyboard buttons."""
    if not TELEGRAM_BOT_TOKEN or not TELEGRAM_CHAT_ID:
        print("  [notify] Telegram not configured, skipping")
        return False

    url = f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage"
    payload: dict[str, Any] = {
        "chat_id": TELEGRAM_CHAT_ID,
        "text": message,
        "parse_mode": "Markdown",
    }

    if buttons:
        payload["reply_markup"] = {"inline_keyboard": buttons}

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


def send_telegram(message: str) -> bool:
    """Send a Markdown message via Telegram Bot API. Returns True on success."""
    return _send_telegram_with_buttons(message)


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


# ── Signal change formatting (condensed + links + accept/decline) ───────


def format_signal_telegram(
    asset_symbol: str,
    asset_id: str,
    signal_color: str,
    headline: str,
    price: float | None = None,
) -> str:
    """Format a condensed signal-change Telegram message with product link."""
    emoji = _EMOJI.get(signal_color, "⚪")
    label = _LABEL.get(signal_color, "WAIT")
    price_str = f" at ${price:,.0f}" if price else ""

    lines = [
        f"{emoji} *{asset_symbol}: {label}*{price_str}",
        "",
        headline,
        "",
        f"[View full brief →]({APP_BASE_URL}/{asset_id})",
    ]
    return "\n".join(lines)


def _signal_telegram_buttons(
    asset_id: str, signal_color: str
) -> list[list[dict[str, str]]]:
    """Build inline keyboard buttons for accept/decline on actionable signals."""
    if signal_color == "grey":
        return [[{"text": "View full brief", "url": f"{APP_BASE_URL}/{asset_id}"}]]

    label = _LABEL.get(signal_color, "WAIT")
    return [
        [
            {
                "text": f"✅ Accept {label}",
                "callback_data": f"accept_{asset_id}_{signal_color}",
            },
            {
                "text": "❌ Decline",
                "callback_data": f"decline_{asset_id}_{signal_color}",
            },
        ],
        [{"text": "View full brief", "url": f"{APP_BASE_URL}/{asset_id}"}],
    ]


def format_signal_email(
    asset_symbol: str,
    asset_id: str,
    signal_color: str,
    headline: str,
    price: float | None = None,
) -> tuple[str, str]:
    """Return (subject, html_body) for a condensed signal-change email with CTA buttons."""
    label = _LABEL.get(signal_color, "WAIT")
    accent = _ACCENT.get(signal_color, "#EBEBEB")
    price_str = f" at ${price:,.0f}" if price else ""
    brief_url = f"{APP_BASE_URL}/{asset_id}"

    subject = f"Vela: {asset_symbol} → {label}{price_str}"

    # Accept/decline buttons only for actionable signals (BUY or SELL)
    action_buttons = ""
    if signal_color != "grey":
        text_color = "#0A0A0A" if signal_color == "grey" else "#FFFFFF"
        action_buttons = f"""
    <div style="margin: 24px 0; text-align: center;">
      <a href="{brief_url}?action=accept&signal={signal_color}" style="display: inline-block; background: {accent}; color: {text_color}; padding: 12px 28px; border: 3px solid #0A0A0A; text-decoration: none; font-weight: 700; font-size: 14px; margin-right: 12px;">✅ ACCEPT {label}</a>
      <a href="{brief_url}?action=decline&signal={signal_color}" style="display: inline-block; background: #FFFBF5; color: #0A0A0A; padding: 12px 28px; border: 3px solid #0A0A0A; text-decoration: none; font-weight: 700; font-size: 14px;">❌ DECLINE</a>
    </div>"""

    html = f"""\
<div style="font-family: Inter, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; background: #FFFBF5; padding: 32px; border: 3px solid #0A0A0A;">
  <div style="border-left: 4px solid {accent}; padding-left: 16px; margin-bottom: 24px;">
    <h2 style="margin: 0 0 4px; color: #0A0A0A; font-size: 20px;">{asset_symbol}: {label}{price_str}</h2>
  </div>
  <p style="font-size: 16px; line-height: 1.6; color: #0A0A0A; margin: 0 0 16px;">{headline}</p>
  {action_buttons}
  <div style="text-align: center; margin: 16px 0;">
    <a href="{brief_url}" style="color: #0A0A0A; font-size: 14px; font-weight: 600;">View full brief →</a>
  </div>
  <hr style="border: none; border-top: 2px solid #EBEBEB; margin: 24px 0;">
  <p style="font-size: 12px; color: #9CA3AF; margin: 0;">Vela — Always watching the markets for you</p>
</div>"""
    return subject, html


# ── Daily digest formatting (condensed + link) ──────────────────────────


def format_digest_telegram(headline: str, summary: str) -> str:
    """Format a condensed daily digest Telegram message with product link."""
    today = datetime.now(timezone.utc).strftime("%b %d")

    # Truncate summary to ~150 chars for condensed view
    truncated = summary[:147] + "..." if len(summary) > 150 else summary

    lines = [
        f"📰 *Vela Daily Digest — {today}*",
        "",
        truncated,
        "",
        f"[Read full digest →]({APP_BASE_URL})",
    ]
    return "\n".join(lines)


def format_digest_email(headline: str, summary: str) -> tuple[str, str]:
    """Return (subject, html_body) for a condensed daily digest email."""
    today = datetime.now(timezone.utc).strftime("%b %d")

    # Truncate for email preview — full version on the product
    truncated = summary[:197] + "..." if len(summary) > 200 else summary

    subject = f"Vela Daily Digest — {today}"
    html = f"""\
<div style="font-family: Inter, -apple-system, sans-serif; max-width: 480px; margin: 0 auto; background: #FFFBF5; padding: 32px; border: 3px solid #0A0A0A;">
  <h2 style="margin: 0 0 16px; color: #0A0A0A; font-size: 20px;">📰 Daily Digest — {today}</h2>
  <p style="font-size: 14px; line-height: 1.6; color: #0A0A0A; margin: 0 0 16px;">{truncated}</p>
  <div style="text-align: center; margin: 24px 0;">
    <a href="{APP_BASE_URL}" style="display: inline-block; background: #0A0A0A; color: #FFFBF5; padding: 12px 28px; border: 3px solid #0A0A0A; text-decoration: none; font-weight: 700; font-size: 14px;">Read full digest →</a>
  </div>
  <hr style="border: none; border-top: 2px solid #EBEBEB; margin: 24px 0;">
  <p style="font-size: 12px; color: #9CA3AF; margin: 0;">Vela — Always watching the markets for you</p>
</div>"""
    return subject, html


# ── Public dispatch functions ───────────────────────────────────────────


def notify_signal_change(
    asset_symbol: str,
    asset_id: str,
    signal_color: str,
    headline: str,
    summary: str = "",
    price: float | None = None,
) -> None:
    """Dispatch a condensed signal-change notification with accept/decline buttons."""
    print(f"  [notify] Signal change: {asset_symbol} → {_LABEL.get(signal_color, '?')}")

    # Telegram: condensed message + inline accept/decline buttons (HTTPS only)
    tg_msg = format_signal_telegram(asset_symbol, asset_id, signal_color, headline, price)
    tg_buttons = _signal_telegram_buttons(asset_id, signal_color) if _USE_INLINE_BUTTONS else None
    _send_telegram_with_buttons(tg_msg, tg_buttons)

    # Email: condensed + accept/decline CTA buttons
    subject, html = format_signal_email(
        asset_symbol, asset_id, signal_color, headline, price
    )
    send_email(subject, html)


def notify_daily_digest(headline: str, summary: str = "") -> None:
    """Dispatch the daily market digest via all configured channels."""
    print("  [notify] Daily digest")

    tg_msg = format_digest_telegram(headline, summary)
    tg_buttons = [[{"text": "Read full digest", "url": APP_BASE_URL}]] if _USE_INLINE_BUTTONS else None
    _send_telegram_with_buttons(tg_msg, tg_buttons)

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

        # Test signal change (with accept/decline buttons)
        notify_signal_change(
            asset_symbol="BTC",
            asset_id="bitcoin",
            signal_color="green",
            headline="Price broke above $95,000 — trend is turning up",
            summary="Strong buying pressure building across all timeframes.",
            price=95420,
        )
        print()

        # Test daily digest (condensed + link)
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
