CREATE TABLE mcvc_installs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_uuid UUID NOT NULL,
    server_type TEXT NOT NULL,
    version TEXT NOT NULL,
    build_id INTEGER NOT NULL,
    is_zip BOOLEAN NOT NULL DEFAULT FALSE,
    clean_install BOOLEAN NOT NULL DEFAULT FALSE,
    success BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_mcvc_installs_server ON mcvc_installs(server_uuid);
CREATE INDEX idx_mcvc_installs_time ON mcvc_installs(installed_at);
