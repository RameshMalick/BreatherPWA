use serde::{Deserialize, Serialize};
use sqlx::FromRow;

#[derive(Serialize, Deserialize, FromRow, Clone, Debug)]
pub struct Session {
    pub id: String,
    pub user_id: String,
    pub date: String,
    pub duration_seconds: i32,
    pub timestamp: i64,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct CreateSessionPayload {
    pub id: String,
    pub user_id: Option<String>,
    pub date: String,
    pub duration_seconds: i32,
    pub timestamp: i64,
}
