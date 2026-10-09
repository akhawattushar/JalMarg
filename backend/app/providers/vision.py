import base64
import io
import json

from .. import config as C

PROMPT = ("You check photos reported to a monsoon waterlogging app. Reported problem: {problem}. "
          'Reply with only JSON: {{"water": true|false, "matches": true|false, "reason": "<max 12 words>"}}. '
          "water = standing or flowing flood water is clearly visible; matches = the photo shows the reported problem.")
_client = None


def check(img, problem):
    """Claude on Amazon Bedrock looks at the photo. Returns a verification signal, or None if not configured or it fails."""
    global _client
    if C.VISION_PROVIDER != "bedrock":
        return None
    try:
        if _client is None:
            from anthropic import AnthropicBedrockMantle
            _client = AnthropicBedrockMantle(aws_region=C.AWS_REGION)
        small = img.copy()
        small.thumbnail((1024, 1024))
        buf = io.BytesIO()
        small.save(buf, "JPEG", quality=80)
        msg = _client.messages.create(model=C.VISION_MODEL, max_tokens=2000, messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": base64.b64encode(buf.getvalue()).decode()}},
            {"type": "text", "text": PROMPT.format(problem=problem.replace("_", " "))}]}])
        if msg.stop_reason == "refusal":
            return None
        text = next(b.text for b in msg.content if b.type == "text")
        r = json.loads(text[text.index("{"):text.rindex("}") + 1])
    except Exception as e:
        print(f"[vision] {e}", flush=True)
        return None
    ok = bool(r.get("water")) and bool(r.get("matches", True))
    return {"key": "visual", "label": ("AI: " if ok else "AI doubt: ") + str(r.get("reason", ""))[:80], "status": "pass" if ok else "warn"}
