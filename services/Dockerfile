# Builds one demo service binary. Usage (from repo root):
#   docker build -f services/Dockerfile --build-arg SERVICE=checkout .
FROM golang:1.23-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY services ./services
ARG SERVICE
RUN CGO_ENABLED=0 go build -trimpath -o /out/svc ./services/${SERVICE}

FROM scratch
COPY --from=build /out/svc /svc
ENTRYPOINT ["/svc"]
