mod handlers;
mod models;

use axum::{
    routing::{get, delete},
    Router,
};
use dotenvy::dotenv;
use sqlx::{sqlite::SqlitePoolOptions, SqlitePool};
use std::env;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

use handlers::{create_session, delete_session, get_sessions, AppState};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    dotenv().ok();

    let database_url = env::var("DATABASE_URL").unwrap_or_else(|_| "sqlite://breather.db".to_string());

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;

    // Create tables if not exist
    init_db(&pool).await?;

    let state = Arc::new(AppState { db: pool });

    // Enable CORS for frontend
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let frontend_dir = env::var("FRONTEND_DIR").unwrap_or_else(|_| "../frontend".to_string());

    let app = Router::new()
        .route("/api/sessions", get(get_sessions).post(create_session))
        .route("/api/sessions/:id", delete(delete_session))
        .fallback_service(ServeDir::new(frontend_dir))
        .layer(cors)
        .with_state(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:3001").await?;
    println!("Server running on http://127.0.0.1:3001");
    axum::serve(listener, app).await?;

    Ok(())
}

async fn init_db(pool: &SqlitePool) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            user_id TEXT NOT NULL DEFAULT 'local-user',
            date TEXT NOT NULL,
            duration_seconds INTEGER NOT NULL,
            timestamp BIGINT NOT NULL
        );
        "#,
    )
    .execute(pool)
    .await.unwrap_or_default();

    Ok(())
}
