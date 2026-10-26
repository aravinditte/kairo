# Kairo API — multi-stage build. Produces a small static binary image.
# NOTE: Docker is not available on the development VM; this Dockerfile is
# provided per the deployment spec and is exercised by CI, not locally.
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/kairo-api ./cmd/kairo-api

FROM alpine:3.20
RUN adduser -D -u 10001 kairo && apk add --no-cache ca-certificates
USER kairo
COPY --from=build /out/kairo-api /usr/local/bin/kairo-api
ENV KAIRO_HTTP_ADDR=:8080
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/kairo-api"]
