from .. import config as C


class LocalStorageService:
    """Files under DATA_DIR/files."""

    root = C.DATA_DIR / "files"

    def put(self, key, data):
        p = self.root / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(data)
        return key

    def read(self, key):
        p = (self.root / key).resolve()
        return p.read_bytes() if p.is_relative_to(self.root.resolve()) and p.is_file() else None

    def url(self, key):
        return f"/files/{key}" if key else None


class S3StorageService(LocalStorageService):
    """Private S3 bucket; files are still served through /files so private evidence keeps its access check."""

    def __init__(self):
        import boto3
        self.s3 = boto3.client("s3", region_name=C.AWS_REGION)

    def put(self, key, data):
        self.s3.put_object(Bucket=C.S3_BUCKET, Key=key, Body=data, ContentType="image/jpeg")
        return key

    def read(self, key):
        try:
            return self.s3.get_object(Bucket=C.S3_BUCKET, Key=key)["Body"].read()
        except self.s3.exceptions.NoSuchKey:
            return None


storage = S3StorageService() if C.STORAGE_PROVIDER == "s3" else LocalStorageService()
