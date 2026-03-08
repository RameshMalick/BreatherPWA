use axum::{
    extract::{Path, State},
    http::StatusCode,
    Json,
};
use sqlx::SqlitePool;
use std::sync::Arc;

use crate::models::{CreateSessionPayload, Session};

pub struct AppState {
    pub db: SqlitePool,
}

pub async fn get_sessions(
    State(state): State<Arc<AppState>>,
) -> Result<Json<Vec<Session>>, (StatusCode, String)> {
    let sessions = sqlx::query_as::<_, Session>("SELECT id, user_id, date, duration_seconds, timestamp FROM sessions ORDER BY timestamp DESC")
        .fetch_all(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(Json(sessions))
}

pub async fn create_session(
    State(state): State<Arc<AppState>>,
    Json(payload): Json<CreateSessionPayload>,
) -> Result<(StatusCode, Json<Session>), (StatusCode, String)> {
    let session = sqlx::query_as::<_, Session>(
        "INSERT INTO sessions (id, user_id, date, duration_seconds, timestamp) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET duration_seconds = excluded.duration_seconds, timestamp = excluded.timestamp RETURNING id, user_id, date, duration_seconds, timestamp",
    )
    .bind(payload.id.clone())
    .bind(payload.user_id.unwrap_or_else(|| "local-user".to_string()))
    .bind(payload.date.clone())
    .bind(payload.duration_seconds)
    .bind(payload.timestamp)
    .fetch_one(&state.db)
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok((StatusCode::CREATED, Json(session)))
}

pub async fn delete_session(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<StatusCode, (StatusCode, String)> {
    sqlx::query("DELETE FROM sessions WHERE id = $1")
        .bind(id)
        .execute(&state.db)
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    Ok(StatusCode::NO_CONTENT)
}
