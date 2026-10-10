import smtplib
import ssl
from email.message import EmailMessage
from html import escape

from . import config as C


def send(to, subject, text, link=None, button=None):
    """Send a transactional email over SMTP, or print it to the API log in development."""
    if C.EMAIL_DELIVERY != "smtp":
        print(f"[EMAIL] to={to} subject={subject!r}\n{text}\n{link or ''}", flush=True)
        return
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = C.SMTP_FROM, to, subject
    msg.set_content(f"{text}\n\n{link}\n" if link else text)
    btn = (f'<p><a href="{escape(link)}" style="display:inline-block;padding:10px 18px;background:#0b1f3a;color:#fff;'
           f'border-radius:6px;text-decoration:none">{escape(button or "Open")}</a></p><p style="color:#64748b;font-size:13px">'
           f'Or paste this link into your browser:<br>{escape(link)}</p>') if link else ""
    msg.add_alternative(f'<div style="font-family:Arial,sans-serif;font-size:15px;color:#0f172a"><p>{escape(text)}</p>{btn}'
                        '<p style="color:#64748b;font-size:13px">— JalMarg</p></div>', subtype="html")
    ctx = ssl.create_default_context()
    if C.SMTP_SECURITY == "ssl":
        server = smtplib.SMTP_SSL(C.SMTP_HOST, C.SMTP_PORT, context=ctx, timeout=20)
    else:
        server = smtplib.SMTP(C.SMTP_HOST, C.SMTP_PORT, timeout=20)
        if C.SMTP_SECURITY == "starttls":
            server.starttls(context=ctx)
    with server:
        if C.SMTP_USERNAME:
            server.login(C.SMTP_USERNAME, C.SMTP_PASSWORD)
        server.send_message(msg)


def safe_send(*a, **kw):
    """Background-task wrapper: a mail failure is logged, never leaked to the caller."""
    try:
        send(*a, **kw)
    except Exception as e:
        print(f"[EMAIL] delivery failed: {type(e).__name__}: {e}", flush=True)
