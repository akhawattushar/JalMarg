FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt requirements-aws.txt ./
RUN pip install --no-cache-dir -r requirements-aws.txt
COPY app ./app
ENV DATA_DIR=/data APP_ENV=production
VOLUME /data
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
