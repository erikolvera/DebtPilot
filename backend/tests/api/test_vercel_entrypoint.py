from app.api.main import app as application
from main import app as vercel_application


def test_vercel_entrypoint_exports_the_application() -> None:
    assert vercel_application is application
