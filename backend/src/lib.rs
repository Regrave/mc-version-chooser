mod settings;

use axum::{extract::Query, http::StatusCode, response::IntoResponse};
use serde::Deserialize;
use shared::{
    GetState,
    extensions::{Extension, ExtensionRouteBuilder},
    models::{
        server::GetServer,
        user::GetPermissionManager,
    },
    State,
};
use std::sync::Arc;

#[derive(Default)]
pub struct ExtensionStruct;

#[async_trait::async_trait]
impl Extension for ExtensionStruct {
    async fn initialize(&mut self, _state: State) {}

    async fn settings_deserializer(
        &self,
        _state: State,
    ) -> shared::extensions::settings::ExtensionSettingsDeserializer {
        Arc::new(settings::McvcSettingsDeserializer)
    }

    async fn initialize_router(
        &mut self,
        _state: State,
        builder: ExtensionRouteBuilder,
    ) -> ExtensionRouteBuilder {
        builder
            .add_client_server_api_router(|router| {
                router
                    .route(
                        "/mc-version-chooser/install",
                        axum::routing::post(install_jar),
                    )
                    .route(
                        "/mc-version-chooser/install/status",
                        axum::routing::get(install_status),
                    )
            })
            .add_admin_api_router(|router| {
                router
                    .route(
                        "/mc-version-chooser/stats",
                        axum::routing::get(admin_stats),
                    )
                    .route(
                        "/mc-version-chooser/installs",
                        axum::routing::get(admin_recent_installs),
                    )
            })
    }
}

const ALLOWED_DOMAINS: &[&str] = &[
    "https://mcjars.app/",
    "https://versions.mcjars.app/",
    "https://files.mcjars.app/",
    "https://fill-data.papermc.io/",
    "https://api.papermc.io/",
    "https://download.mcjars.app/",
    "https://piston-data.mojang.com/",
    "https://launcher.mojang.com/",
    "https://maven.fabricmc.net/",
    "https://maven.neoforged.net/",
    "https://maven.minecraftforge.net/",
    "https://api.purpurmc.org/",
    "https://download.getbukkit.org/",
    "https://serverjars.com/",
];

#[derive(Deserialize)]
struct InstallParams {
    url: String,
    #[serde(default = "default_filename")]
    filename: String,
    #[serde(default)]
    unzip: bool,
    #[serde(default)]
    clean_install: bool,
    #[serde(default)]
    server_type: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    build_id: Option<i32>,
}

fn default_filename() -> String {
    "server.jar".to_string()
}

fn err(status: StatusCode, msg: impl Into<String>) -> (StatusCode, String) {
    (status, msg.into())
}

/// Delete all files in the server root (clean install)
async fn wipe_server_files(
    wings: &wings_api::client::WingsClient,
    server_uuid: uuid::Uuid,
) {
    let entries = match wings
        .get_servers_server_files_list_directory(server_uuid, "/")
        .await
    {
        Ok(entries) => entries,
        Err(_) => return,
    };

    let files: Vec<compact_str::CompactString> = entries
        .iter()
        .map(|e| e.name.clone())
        .collect();

    if !files.is_empty() {
        let _ = wings
            .post_servers_server_files_delete(
                server_uuid,
                &wings_api::servers_server_files_delete::post::RequestBody {
                    root: "/".into(),
                    files,
                },
            )
            .await;
    }
}

/// Record an installation in the database
async fn record_install(
    db: &shared::database::Database,
    server_uuid: uuid::Uuid,
    server_type: &str,
    version: &str,
    build_id: i32,
    is_zip: bool,
    clean_install: bool,
    success: bool,
) {
    let _ = sqlx::query(
        "INSERT INTO mcvc_installs (server_uuid, server_type, version, build_id, is_zip, clean_install, success)
         VALUES ($1, $2, $3, $4, $5, $6, $7)"
    )
    .bind(server_uuid)
    .bind(server_type)
    .bind(version)
    .bind(build_id)
    .bind(is_zip)
    .bind(clean_install)
    .bind(success)
    .execute(db.write())
    .await;
}

/// POST: Install a server jar/zip from URL
async fn install_jar(
    state: GetState,
    permissions: GetPermissionManager,
    mut server: GetServer,
    Query(params): Query<InstallParams>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    permissions
        .has_server_permission("files.create")
        .map_err(|_| err(StatusCode::FORBIDDEN, "Missing files.create permission"))?;

    if !ALLOWED_DOMAINS.iter().any(|d| params.url.starts_with(d)) {
        return Err(err(StatusCode::BAD_REQUEST, "URL domain not allowed"));
    }

    let node = server
        .node
        .fetch_cached(&state.database)
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let wings = node
        .api_client(&state.database)
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    // Clean install: wipe all server files first
    if params.clean_install {
        wipe_server_files(&wings, server.uuid).await;
    }

    let result = if params.unzip {
        do_zip_install(&wings, &server, &params).await
    } else {
        do_jar_install(&wings, &server, &params).await
    };

    // Track the install if we have metadata
    if let Some(ref server_type) = params.server_type {
        let version = params.version.as_deref().unwrap_or("unknown");
        let build_id = params.build_id.unwrap_or(0);
        record_install(
            &state.database,
            server.uuid,
            server_type,
            version,
            build_id,
            params.unzip,
            params.clean_install,
            result.is_ok(),
        )
        .await;
    }

    result
}

async fn do_zip_install(
    wings: &wings_api::client::WingsClient,
    server: &shared::models::server::Server,
    params: &InstallParams,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    if !params.clean_install {
        let _ = wings
            .post_servers_server_files_delete(
                server.uuid,
                &wings_api::servers_server_files_delete::post::RequestBody {
                    root: "/".into(),
                    files: vec!["libraries".into()],
                },
            )
            .await;
    }

    let pull_result = wings
        .post_servers_server_files_pull(
            server.uuid,
            &wings_api::servers_server_files_pull::post::RequestBody {
                root: "/".into(),
                url: params.url.clone().into(),
                file_name: Some("mcvc_install.zip".into()),
                use_header: false,
                foreground: true,
            },
        )
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("Wings pull failed: {e:?}")))?;

    let _ = wings
        .post_servers_server_files_decompress(
            server.uuid,
            &wings_api::servers_server_files_decompress::post::RequestBody {
                root: "/".into(),
                file: "mcvc_install.zip".into(),
                foreground: true,
            },
        )
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("Wings decompress failed: {e:?}")))?;

    let _ = wings
        .post_servers_server_files_delete(
            server.uuid,
            &wings_api::servers_server_files_delete::post::RequestBody {
                root: "/".into(),
                files: vec!["mcvc_install.zip".into()],
            },
        )
        .await;

    let identifier = match pull_result {
        wings_api::servers_server_files_pull::post::Response::Accepted(r) => Some(r.identifier),
        wings_api::servers_server_files_pull::post::Response::Ok(_) => None,
    };

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "identifier": identifier,
    })))
}

async fn do_jar_install(
    wings: &wings_api::client::WingsClient,
    server: &shared::models::server::Server,
    params: &InstallParams,
) -> Result<axum::Json<serde_json::Value>, (StatusCode, String)> {
    if !params.clean_install {
        let _ = wings
            .post_servers_server_files_delete(
                server.uuid,
                &wings_api::servers_server_files_delete::post::RequestBody {
                    root: "/".into(),
                    files: vec![params.filename.clone().into()],
                },
            )
            .await;
    }

    let pull_result = wings
        .post_servers_server_files_pull(
            server.uuid,
            &wings_api::servers_server_files_pull::post::RequestBody {
                root: "/".into(),
                url: params.url.clone().into(),
                file_name: Some(params.filename.clone().into()),
                use_header: false,
                foreground: false,
            },
        )
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("Wings pull failed: {e:?}")))?;

    let identifier = match pull_result {
        wings_api::servers_server_files_pull::post::Response::Accepted(r) => Some(r.identifier),
        wings_api::servers_server_files_pull::post::Response::Ok(_) => None,
    };

    Ok(axum::Json(serde_json::json!({
        "success": true,
        "identifier": identifier,
    })))
}

/// GET: Check pull download progress from Wings
async fn install_status(
    state: GetState,
    _permissions: GetPermissionManager,
    mut server: GetServer,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let node = server
        .node
        .fetch_cached(&state.database)
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let wings = node
        .api_client(&state.database)
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let pulls = wings
        .get_servers_server_files_pull(server.uuid)
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, format!("{e:?}")))?;

    if let Some(dl) = pulls.downloads.first() {
        Ok(axum::Json(serde_json::json!({
            "state": "downloading",
            "progress": dl.progress,
            "total": dl.total,
            "identifier": dl.identifier,
        })))
    } else {
        Ok(axum::Json(serde_json::json!({
            "state": "done",
        })))
    }
}

// ─── Admin API (stats only — settings handled by the panel's built-in system) ──

#[derive(Deserialize)]
struct StatsQuery {
    #[serde(default = "default_days")]
    days: i32,
}

fn default_days() -> i32 {
    30
}

/// GET /admin/mc-version-chooser/stats
async fn admin_stats(
    state: GetState,
    Query(query): Query<StatsQuery>,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let cutoff = chrono::Utc::now() - chrono::Duration::days(query.days as i64);

    let type_stats = sqlx::query_as::<_, (String, i64)>(
        "SELECT server_type, COUNT(*) as count FROM mcvc_installs
         WHERE installed_at >= $1
         GROUP BY server_type ORDER BY count DESC"
    )
    .bind(cutoff)
    .fetch_all(state.database.read())
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let outcome_stats = sqlx::query_as::<_, (bool, i64)>(
        "SELECT success, COUNT(*) as count FROM mcvc_installs
         WHERE installed_at >= $1
         GROUP BY success"
    )
    .bind(cutoff)
    .fetch_all(state.database.read())
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let total: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM mcvc_installs WHERE installed_at >= $1"
    )
    .bind(cutoff)
    .fetch_one(state.database.read())
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let clean_count: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM mcvc_installs WHERE installed_at >= $1 AND clean_install = true"
    )
    .bind(cutoff)
    .fetch_one(state.database.read())
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let unique_servers: (i64,) = sqlx::query_as(
        "SELECT COUNT(DISTINCT server_uuid) FROM mcvc_installs WHERE installed_at >= $1"
    )
    .bind(cutoff)
    .fetch_one(state.database.read())
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let mut successes: i64 = 0;
    let mut failures: i64 = 0;
    for (success, count) in &outcome_stats {
        if *success { successes = *count; } else { failures = *count; }
    }

    let type_distribution: Vec<serde_json::Value> = type_stats
        .iter()
        .map(|(t, c)| serde_json::json!({"type": t, "count": c}))
        .collect();

    Ok(axum::Json(serde_json::json!({
        "total": total.0,
        "successes": successes,
        "failures": failures,
        "clean_installs": clean_count.0,
        "unique_servers": unique_servers.0,
        "type_distribution": type_distribution,
        "days": query.days,
    })))
}

/// GET /admin/mc-version-chooser/installs
async fn admin_recent_installs(
    state: GetState,
) -> Result<impl IntoResponse, (StatusCode, String)> {
    let rows = sqlx::query_as::<_, (uuid::Uuid, uuid::Uuid, String, String, i32, bool, bool, bool, chrono::DateTime<chrono::Utc>)>(
        "SELECT id, server_uuid, server_type, version, build_id, is_zip, clean_install, success, installed_at
         FROM mcvc_installs ORDER BY installed_at DESC LIMIT 50"
    )
    .fetch_all(state.database.read())
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?;

    let installs: Vec<serde_json::Value> = rows
        .iter()
        .map(|(id, server_uuid, server_type, version, build_id, is_zip, clean, success, installed_at)| {
            serde_json::json!({
                "id": id,
                "server_uuid": server_uuid,
                "server_type": server_type,
                "version": version,
                "build_id": build_id,
                "is_zip": is_zip,
                "clean_install": clean,
                "success": success,
                "installed_at": installed_at.to_rfc3339(),
            })
        })
        .collect();

    Ok(axum::Json(serde_json::json!({ "installs": installs })))
}
