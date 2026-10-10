from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from . import auth, db
from . import config as C
from .routes_auth import r as auth_routes
from .routes_public import r as public
from .routes_staff import r as staff

db.init()
auth.bootstrap_admin()
app = FastAPI(title="JalMarg API", version="2.0.0", docs_url="/docs" if C.APP_ENV != "production" else None)
app.add_middleware(CORSMiddleware, allow_origins=C.CORS_ORIGINS, allow_methods=["GET", "POST", "PATCH", "DELETE"],
                   allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    res = await call_next(request)
    res.headers.setdefault("X-Content-Type-Options", "nosniff")
    res.headers.setdefault("Referrer-Policy", "no-referrer")
    res.headers.setdefault("X-Frame-Options", "DENY")
    if C.APP_ENV == "production":
        res.headers.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
    return res


app.include_router(auth_routes)
app.include_router(public)
app.include_router(staff)


@app.get("/health")
def health():
    return {"ok": True, "map_provider": C.MAP_PROVIDER, "weather_provider": C.WEATHER_PROVIDER}
