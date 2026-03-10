FROM rust:1.85-bookworm AS builder

# Set working directory to the root of the copy
WORKDIR /usr/src/app

# Copy the ENTIRE monorepo (frontend + backend) into the container
COPY . .

# Build the Rust application from the backend directory
WORKDIR /usr/src/app/backend
RUN cargo build --release

# Stage 2: Lean runtime
FROM debian:bookworm-slim

# Install sqlite3 libraries required by libsqlite3-sys
RUN apt-get update && apt-get install -y libsqlite3-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /usr/src/app/backend/target/release/backend /usr/local/bin/backend

# Copy the frontend files into the runtime container
COPY --from=builder /usr/src/app/frontend /app/frontend

# Create a directory to hold the SQLite database persistently
RUN mkdir -p /app/data && touch /app/data/breather.db

# Set environment variables for DB and Frontend
ENV DATABASE_URL="sqlite:///app/data/breather.db"
ENV FRONTEND_DIR="/app/frontend"

# Expose the port the Axum server listens on
EXPOSE 3001

# Execute the binary
CMD ["backend"]
