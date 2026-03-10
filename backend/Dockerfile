FROM rust:1.85-bookworm AS builder

WORKDIR /usr/src/app

# Copy the backend code into the container
COPY . .

# Build the Rust application in release mode for maximum performance
RUN cargo build --release

# Stage 2: Lean runtime
FROM debian:bookworm-slim

# Install sqlite3 libraries required by libsqlite3-sys
RUN apt-get update && apt-get install -y libsqlite3-0 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the compiled binary from the builder stage
COPY --from=builder /usr/src/app/target/release/backend /usr/local/bin/backend

# Create a directory to hold the SQLite database persistently
RUN mkdir -p /app/data && touch /app/data/breather.db
ENV DATABASE_URL="sqlite:///app/data/breather.db"

# Expose the port the Axum server listens on
EXPOSE 3001

# Execute the binary
CMD ["backend"]
