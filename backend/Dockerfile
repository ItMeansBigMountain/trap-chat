FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN rm -f trapchat.db

EXPOSE 8080
CMD ["sh", "-c", "exec gunicorn --worker-class gthread --workers 1 --threads 100 --timeout 120 --bind 0.0.0.0:${PORT} app:app"]
