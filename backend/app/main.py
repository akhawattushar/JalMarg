from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import config as C
from . import db
from .routes_public import r as public
from .routes_staff import r as staff

db.init()
app = FastAPI(title="JalMarg API", version="2.0.0", docs_url="/docs" if C.APP_ENV != "production" else None)
app.add_middleware(CORSMiddleware, allow_origins=C.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])
app.include_router(public)
app.include_router(staff)


@app.get("/health")
def health():
    return {"ok": True, "map_provider": C.MAP_PROVIDER, "weather_provider": C.WEATHER_PROVIDER}
