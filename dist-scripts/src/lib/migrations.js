import { readFileSync } from 'fs';
import { join } from 'path';
// Plugin hook: extensions can register additional migrations without modifying this file.
const extraMigrations = [];
export function registerMigrations(newMigrations) {
    extraMigrations.push(...newMigrations);
}
const migrations = [
    {
        id: '001_init',
        up: (db) => {
            const schemaPath = join(process.cwd(), 'src', 'lib', 'schema.sql');
            const schema = readFileSync(schemaPath, 'utf8');
            const statements = schema.split(';').filter((stmt) => stmt.trim());
            db.transaction(() => {
                for (const statement of statements) {
                    db.exec(statement.trim());
                }
            })();
        }
    },
    {
        id: '002_quality_reviews',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS quality_reviews (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          reviewer TEXT NOT NULL,
          status TEXT NOT NULL,
          notes TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_task_id ON quality_reviews(task_id);
        CREATE INDEX IF NOT EXISTS idx_quality_reviews_reviewer ON quality_reviews(reviewer);
      `);
        }
    },
    {
        id: '003_quality_review_status_backfill',
        up: (db) => {
            // Convert existing review tasks to quality_review to enforce the gate
            db.exec(`
        UPDATE tasks
        SET status = 'quality_review'
        WHERE status = 'review';
      `);
        }
    },
    {
        id: '004_messages',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          conversation_id TEXT NOT NULL,
          from_agent TEXT NOT NULL,
          to_agent TEXT,
          content TEXT NOT NULL,
          message_type TEXT DEFAULT 'text',
          metadata TEXT,
          read_at INTEGER,
          created_at INTEGER DEFAULT (unixepoch())
        )
      `);
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at)
      `);
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_messages_agents ON messages(from_agent, to_agent)
      `);
        }
    },
    {
        id: '006_workflow_templates',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_templates (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          model TEXT NOT NULL DEFAULT 'sonnet',
          task_prompt TEXT NOT NULL,
          timeout_seconds INTEGER NOT NULL DEFAULT 300,
          agent_role TEXT,
          tags TEXT,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_used_at INTEGER,
          use_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_workflow_templates_name ON workflow_templates(name);
        CREATE INDEX IF NOT EXISTS idx_workflow_templates_created_by ON workflow_templates(created_by);
      `);
        }
    },
    {
        id: '007_audit_log',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          action TEXT NOT NULL,
          actor TEXT NOT NULL,
          actor_id INTEGER,
          target_type TEXT,
          target_id INTEGER,
          detail TEXT,
          ip_address TEXT,
          user_agent TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
        CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor);
        CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at);
      `);
        }
    },
    {
        id: '008_webhooks',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS webhooks (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          url TEXT NOT NULL,
          secret TEXT,
          events TEXT NOT NULL DEFAULT '["*"]',
          enabled INTEGER NOT NULL DEFAULT 1,
          last_fired_at INTEGER,
          last_status INTEGER,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS webhook_deliveries (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          webhook_id INTEGER NOT NULL,
          event_type TEXT NOT NULL,
          payload TEXT NOT NULL,
          status_code INTEGER,
          response_body TEXT,
          error TEXT,
          duration_ms INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (webhook_id) REFERENCES webhooks(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_webhook_id ON webhook_deliveries(webhook_id);
        CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_created_at ON webhook_deliveries(created_at);
        CREATE INDEX IF NOT EXISTS idx_webhooks_enabled ON webhooks(enabled);
      `);
        }
    },
    {
        id: '009_pipelines',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS workflow_pipelines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          steps TEXT NOT NULL DEFAULT '[]',
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          use_count INTEGER NOT NULL DEFAULT 0,
          last_used_at INTEGER
        );

        CREATE TABLE IF NOT EXISTS pipeline_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          pipeline_id INTEGER NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          current_step INTEGER NOT NULL DEFAULT 0,
          steps_snapshot TEXT NOT NULL DEFAULT '[]',
          started_at INTEGER,
          completed_at INTEGER,
          triggered_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (pipeline_id) REFERENCES workflow_pipelines(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
        CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
        CREATE INDEX IF NOT EXISTS idx_workflow_pipelines_name ON workflow_pipelines(name);
      `);
        }
    },
    {
        id: '010_settings',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          description TEXT,
          category TEXT NOT NULL DEFAULT 'general',
          updated_by TEXT,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_settings_category ON settings(category);
      `);
        }
    },
    {
        id: '011_alert_rules',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS alert_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          entity_type TEXT NOT NULL,
          condition_field TEXT NOT NULL,
          condition_operator TEXT NOT NULL,
          condition_value TEXT NOT NULL,
          action_type TEXT NOT NULL DEFAULT 'notification',
          action_config TEXT NOT NULL DEFAULT '{}',
          cooldown_minutes INTEGER NOT NULL DEFAULT 60,
          last_triggered_at INTEGER,
          trigger_count INTEGER NOT NULL DEFAULT 0,
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE INDEX IF NOT EXISTS idx_alert_rules_enabled ON alert_rules(enabled);
        CREATE INDEX IF NOT EXISTS idx_alert_rules_entity_type ON alert_rules(entity_type);
      `);
        }
    },
    {
        id: '012_super_admin_tenants',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS tenants (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          display_name TEXT NOT NULL,
          linux_user TEXT NOT NULL UNIQUE,
          plan_tier TEXT NOT NULL DEFAULT 'standard',
          status TEXT NOT NULL DEFAULT 'pending',
          openclaw_home TEXT NOT NULL,
          workspace_root TEXT NOT NULL,
          gateway_port INTEGER,
          dashboard_port INTEGER,
          config TEXT NOT NULL DEFAULT '{}',
          created_by TEXT NOT NULL DEFAULT 'system',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );

        CREATE TABLE IF NOT EXISTS provision_jobs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          tenant_id INTEGER NOT NULL,
          job_type TEXT NOT NULL DEFAULT 'bootstrap',
          status TEXT NOT NULL DEFAULT 'queued',
          dry_run INTEGER NOT NULL DEFAULT 1,
          requested_by TEXT NOT NULL DEFAULT 'system',
          approved_by TEXT,
          runner_host TEXT,
          idempotency_key TEXT,
          request_json TEXT NOT NULL DEFAULT '{}',
          plan_json TEXT NOT NULL DEFAULT '[]',
          result_json TEXT,
          error_text TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS provision_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          job_id INTEGER NOT NULL,
          level TEXT NOT NULL DEFAULT 'info',
          step_key TEXT,
          message TEXT NOT NULL,
          data TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (job_id) REFERENCES provision_jobs(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
        CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
        CREATE INDEX IF NOT EXISTS idx_provision_jobs_tenant_id ON provision_jobs(tenant_id);
        CREATE INDEX IF NOT EXISTS idx_provision_jobs_status ON provision_jobs(status);
        CREATE INDEX IF NOT EXISTS idx_provision_jobs_created_at ON provision_jobs(created_at);
        CREATE INDEX IF NOT EXISTS idx_provision_events_job_id ON provision_events(job_id);
        CREATE INDEX IF NOT EXISTS idx_provision_events_created_at ON provision_events(created_at);
      `);
        }
    },
    {
        id: '013_tenant_owner_gateway',
        up: (db) => {
            // Check if tenants table exists (may not on fresh installs without super-admin)
            const hasTenants = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'`).get();
            if (!hasTenants)
                return;
            const columns = db.prepare(`PRAGMA table_info(tenants)`).all();
            const hasOwnerGateway = columns.some((c) => c.name === 'owner_gateway');
            if (!hasOwnerGateway) {
                db.exec(`ALTER TABLE tenants ADD COLUMN owner_gateway TEXT`);
            }
            const defaultGatewayName = String(process.env.MC_DEFAULT_OWNER_GATEWAY || process.env.MC_DEFAULT_GATEWAY_NAME || 'primary').trim() ||
                'primary';
            // Check if gateways table exists (created lazily by gateways API, not in migrations)
            const hasGateways = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='gateways'`).get();
            if (hasGateways) {
                db.prepare(`
          UPDATE tenants
          SET owner_gateway = COALESCE(
            (SELECT name FROM gateways ORDER BY is_primary DESC, id ASC LIMIT 1),
            ?
          )
          WHERE owner_gateway IS NULL OR trim(owner_gateway) = ''
        `).run(defaultGatewayName);
            }
            else {
                db.prepare(`
          UPDATE tenants
          SET owner_gateway = ?
          WHERE owner_gateway IS NULL OR trim(owner_gateway) = ''
        `).run(defaultGatewayName);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tenants_owner_gateway ON tenants(owner_gateway)`);
        }
    },
    {
        id: '014_auth_google_approvals',
        up: (db) => {
            const userCols = db.prepare(`PRAGMA table_info(users)`).all();
            const has = (name) => userCols.some((c) => c.name === name);
            if (!has('provider'))
                db.exec(`ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'`);
            if (!has('provider_user_id'))
                db.exec(`ALTER TABLE users ADD COLUMN provider_user_id TEXT`);
            if (!has('email'))
                db.exec(`ALTER TABLE users ADD COLUMN email TEXT`);
            if (!has('avatar_url'))
                db.exec(`ALTER TABLE users ADD COLUMN avatar_url TEXT`);
            if (!has('is_approved'))
                db.exec(`ALTER TABLE users ADD COLUMN is_approved INTEGER NOT NULL DEFAULT 1`);
            if (!has('approved_by'))
                db.exec(`ALTER TABLE users ADD COLUMN approved_by TEXT`);
            if (!has('approved_at'))
                db.exec(`ALTER TABLE users ADD COLUMN approved_at INTEGER`);
            db.exec(`
        UPDATE users
        SET provider = COALESCE(NULLIF(provider, ''), 'local'),
            is_approved = COALESCE(is_approved, 1)
      `);
            db.exec(`
        CREATE TABLE IF NOT EXISTS access_requests (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          provider TEXT NOT NULL DEFAULT 'google',
          email TEXT NOT NULL,
          provider_user_id TEXT,
          display_name TEXT,
          avatar_url TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          requested_at INTEGER NOT NULL DEFAULT (unixepoch()),
          last_attempt_at INTEGER NOT NULL DEFAULT (unixepoch()),
          attempt_count INTEGER NOT NULL DEFAULT 1,
          reviewed_by TEXT,
          reviewed_at INTEGER,
          review_note TEXT,
          approved_user_id INTEGER,
          FOREIGN KEY (approved_user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_access_requests_email_provider ON access_requests(email, provider)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_access_requests_status ON access_requests(status)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_users_provider ON users(provider)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
        }
    },
    {
        id: '015_missing_indexes',
        up: (db) => {
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at);
        CREATE INDEX IF NOT EXISTS idx_notifications_recipient_read ON notifications(recipient, read_at);
        CREATE INDEX IF NOT EXISTS idx_activities_actor ON activities(actor);
        CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id);
        CREATE INDEX IF NOT EXISTS idx_messages_read_at ON messages(read_at);
      `);
        }
    },
    {
        id: '016_direct_connections',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS direct_connections (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
          tool_name TEXT NOT NULL,
          tool_version TEXT,
          connection_id TEXT NOT NULL UNIQUE,
          status TEXT NOT NULL DEFAULT 'connected',
          last_heartbeat INTEGER,
          metadata TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_direct_connections_agent_id ON direct_connections(agent_id);
        CREATE INDEX IF NOT EXISTS idx_direct_connections_connection_id ON direct_connections(connection_id);
        CREATE INDEX IF NOT EXISTS idx_direct_connections_status ON direct_connections(status);
      `);
        }
    },
    {
        id: '017_github_sync',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS github_syncs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          repo TEXT NOT NULL,
          last_synced_at INTEGER NOT NULL DEFAULT (unixepoch()),
          issue_count INTEGER NOT NULL DEFAULT 0,
          sync_direction TEXT NOT NULL DEFAULT 'inbound',
          status TEXT NOT NULL DEFAULT 'success',
          error TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_github_syncs_repo ON github_syncs(repo);
        CREATE INDEX IF NOT EXISTS idx_github_syncs_created_at ON github_syncs(created_at);
      `);
        }
    },
    {
        id: '018_token_usage',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS token_usage (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          model TEXT NOT NULL,
          session_id TEXT NOT NULL,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
        CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id);
        CREATE INDEX IF NOT EXISTS idx_token_usage_created_at ON token_usage(created_at);
        CREATE INDEX IF NOT EXISTS idx_token_usage_model ON token_usage(model);
      `);
        }
    },
    {
        id: '019_webhook_retry',
        up: (db) => {
            // Add retry columns to webhook_deliveries
            const deliveryCols = db.prepare(`PRAGMA table_info(webhook_deliveries)`).all();
            const hasCol = (name) => deliveryCols.some((c) => c.name === name);
            if (!hasCol('attempt'))
                db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0`);
            if (!hasCol('next_retry_at'))
                db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN next_retry_at INTEGER`);
            if (!hasCol('is_retry'))
                db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN is_retry INTEGER NOT NULL DEFAULT 0`);
            if (!hasCol('parent_delivery_id'))
                db.exec(`ALTER TABLE webhook_deliveries ADD COLUMN parent_delivery_id INTEGER`);
            // Add circuit breaker column to webhooks
            const webhookCols = db.prepare(`PRAGMA table_info(webhooks)`).all();
            if (!webhookCols.some((c) => c.name === 'consecutive_failures')) {
                db.exec(`ALTER TABLE webhooks ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0`);
            }
            // Partial index for retry queue processing
            db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_retry ON webhook_deliveries(next_retry_at) WHERE next_retry_at IS NOT NULL`);
        }
    },
    {
        id: '020_claude_sessions',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS claude_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL UNIQUE,
          project_slug TEXT NOT NULL,
          project_path TEXT,
          model TEXT,
          git_branch TEXT,
          user_messages INTEGER NOT NULL DEFAULT 0,
          assistant_messages INTEGER NOT NULL DEFAULT 0,
          tool_uses INTEGER NOT NULL DEFAULT 0,
          input_tokens INTEGER NOT NULL DEFAULT 0,
          output_tokens INTEGER NOT NULL DEFAULT 0,
          estimated_cost REAL NOT NULL DEFAULT 0,
          first_message_at TEXT,
          last_message_at TEXT,
          last_user_prompt TEXT,
          is_active INTEGER NOT NULL DEFAULT 0,
          scanned_at INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_claude_sessions_active ON claude_sessions(is_active) WHERE is_active = 1`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_claude_sessions_project ON claude_sessions(project_slug)`);
        }
    },
    {
        id: '021_workspace_isolation_phase1',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS workspaces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        );
      `);
            db.prepare(`
        INSERT OR IGNORE INTO workspaces (id, slug, name, created_at, updated_at)
        VALUES (1, 'default', 'Default Workspace', unixepoch(), unixepoch())
      `).run();
            const addWorkspaceIdColumn = (table) => {
                const tableExists = db
                    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
                    .get(table);
                if (!(tableExists === null || tableExists === void 0 ? void 0 : tableExists.ok))
                    return;
                const cols = db.prepare(`PRAGMA table_info(${table})`).all();
                if (!cols.some((c) => c.name === 'workspace_id')) {
                    db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`);
                }
                db.exec(`UPDATE ${table} SET workspace_id = COALESCE(workspace_id, 1)`);
            };
            // No users or user_sessions here, they are handled by the new migration 046
            const scopedTables = [
                'tasks',
                'agents',
                'comments',
                'activities',
                'notifications',
                'quality_reviews',
                'standup_reports',
            ];
            for (const table of scopedTables) {
                addWorkspaceIdColumn(table);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug)`);
            // Old user indexes removed to prevent conflict with 046
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_workspace_id ON agents(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_workspace_id ON comments(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_activities_workspace_id ON activities(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_notifications_workspace_id ON notifications(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_quality_reviews_workspace_id ON quality_reviews(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_standup_reports_workspace_id ON standup_reports(workspace_id)`);
        }
    },
    {
        id: '022_workspace_isolation_phase2',
        up: (db) => {
            const addWorkspaceIdColumn = (table) => {
                const tableExists = db
                    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
                    .get(table);
                if (!(tableExists === null || tableExists === void 0 ? void 0 : tableExists.ok))
                    return;
                const cols = db.prepare(`PRAGMA table_info(${table})`).all();
                if (!cols.some((c) => c.name === 'workspace_id')) {
                    db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`);
                }
                db.exec(`UPDATE ${table} SET workspace_id = COALESCE(workspace_id, 1)`);
            };
            const scopedTables = [
                'messages',
                'alert_rules',
                'direct_connections',
                'github_syncs',
                'workflow_pipelines',
                'pipeline_runs',
            ];
            for (const table of scopedTables) {
                addWorkspaceIdColumn(table);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON messages(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_alert_rules_workspace_id ON alert_rules(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_direct_connections_workspace_id ON direct_connections(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_github_syncs_workspace_id ON github_syncs(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_pipelines_workspace_id ON workflow_pipelines(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_pipeline_runs_workspace_id ON pipeline_runs(workspace_id)`);
        }
    },
    {
        id: '023_workspace_isolation_phase3',
        up: (db) => {
            const addWorkspaceIdColumn = (table) => {
                const tableExists = db
                    .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = ?`)
                    .get(table);
                if (!(tableExists === null || tableExists === void 0 ? void 0 : tableExists.ok))
                    return;
                const cols = db.prepare(`PRAGMA table_info(${table})`).all();
                if (!cols.some((c) => c.name === 'workspace_id')) {
                    db.exec(`ALTER TABLE ${table} ADD COLUMN workspace_id INTEGER NOT NULL DEFAULT 1`);
                }
                db.exec(`UPDATE ${table} SET workspace_id = COALESCE(workspace_id, 1)`);
            };
            const scopedTables = [
                'workflow_templates',
                'webhooks',
                'webhook_deliveries',
                'token_usage',
            ];
            for (const table of scopedTables) {
                addWorkspaceIdColumn(table);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_templates_workspace_id ON workflow_templates(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_webhooks_workspace_id ON webhooks(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_workspace_id ON webhook_deliveries(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_id ON token_usage(workspace_id)`);
        }
    },
    {
        id: '024_projects_support',
        up: (db) => {
            db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          name TEXT NOT NULL,
          slug TEXT NOT NULL,
          description TEXT,
          ticket_prefix TEXT NOT NULL,
          ticket_counter INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'active',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(workspace_id, slug),
          UNIQUE(workspace_id, ticket_prefix)
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_projects_workspace_status ON projects(workspace_id, status)`);
            const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all();
            if (!taskCols.some((c) => c.name === 'project_id')) {
                db.exec(`ALTER TABLE tasks ADD COLUMN project_id INTEGER`);
            }
            if (!taskCols.some((c) => c.name === 'project_ticket_no')) {
                db.exec(`ALTER TABLE tasks ADD COLUMN project_ticket_no INTEGER`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_project ON tasks(workspace_id, project_id)`);
            const workspaceRows = db.prepare(`SELECT id FROM workspaces ORDER BY id ASC`).all();
            const ensureDefaultProject = db.prepare(`
        INSERT OR IGNORE INTO projects (workspace_id, name, slug, description, ticket_prefix, ticket_counter, status, created_at, updated_at)
        VALUES (?, 'General', 'general', 'Default project for uncategorized tasks', 'TASK', 0, 'active', unixepoch(), unixepoch())
      `);
            const getDefaultProject = db.prepare(`
        SELECT id, ticket_counter FROM projects
        WHERE workspace_id = ? AND slug = 'general'
        LIMIT 1
      `);
            const setTaskProject = db.prepare(`
        UPDATE tasks SET project_id = ?
        WHERE workspace_id = ? AND (project_id IS NULL OR project_id = 0)
      `);
            const listProjectTasks = db.prepare(`
        SELECT id FROM tasks
        WHERE workspace_id = ? AND project_id = ?
        ORDER BY created_at ASC, id ASC
      `);
            const setTaskNo = db.prepare(`UPDATE tasks SET project_ticket_no = ? WHERE id = ?`);
            const setProjectCounter = db.prepare(`UPDATE projects SET ticket_counter = ?, updated_at = unixepoch() WHERE id = ?`);
            for (const workspace of workspaceRows) {
                ensureDefaultProject.run(workspace.id);
                const defaultProject = getDefaultProject.get(workspace.id);
                if (!defaultProject)
                    continue;
                setTaskProject.run(defaultProject.id, workspace.id);
                const projectRows = db.prepare(`
          SELECT id FROM projects
          WHERE workspace_id = ?
          ORDER BY id ASC
        `).all(workspace.id);
                for (const project of projectRows) {
                    const tasks = listProjectTasks.all(workspace.id, project.id);
                    let counter = 0;
                    for (const task of tasks) {
                        counter += 1;
                        setTaskNo.run(counter, task.id);
                    }
                    setProjectCounter.run(counter, project.id);
                }
            }
        }
    },
    {
        id: '025_token_usage_task_attribution',
        up: (db) => {
            const hasTokenUsageTable = db
                .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'token_usage'`)
                .get();
            if (!(hasTokenUsageTable === null || hasTokenUsageTable === void 0 ? void 0 : hasTokenUsageTable.ok))
                return;
            const cols = db.prepare(`PRAGMA table_info(token_usage)`).all();
            const hasCol = (name) => cols.some((c) => c.name === name);
            if (!hasCol('task_id')) {
                db.exec(`ALTER TABLE token_usage ADD COLUMN task_id INTEGER`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_task_id ON token_usage(task_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_token_usage_workspace_task_time ON token_usage(workspace_id, task_id, created_at)`);
        }
    },
    {
        id: '026_task_outcome_tracking',
        up: (db) => {
            const hasTasks = db
                .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'tasks'`)
                .get();
            if (!(hasTasks === null || hasTasks === void 0 ? void 0 : hasTasks.ok))
                return;
            const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all();
            const hasCol = (name) => taskCols.some((c) => c.name === name);
            if (!hasCol('outcome'))
                db.exec(`ALTER TABLE tasks ADD COLUMN outcome TEXT`);
            if (!hasCol('error_message'))
                db.exec(`ALTER TABLE tasks ADD COLUMN error_message TEXT`);
            if (!hasCol('resolution'))
                db.exec(`ALTER TABLE tasks ADD COLUMN resolution TEXT`);
            if (!hasCol('feedback_rating'))
                db.exec(`ALTER TABLE tasks ADD COLUMN feedback_rating INTEGER`);
            if (!hasCol('feedback_notes'))
                db.exec(`ALTER TABLE tasks ADD COLUMN feedback_notes TEXT`);
            if (!hasCol('retry_count'))
                db.exec(`ALTER TABLE tasks ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0`);
            if (!hasCol('completed_at'))
                db.exec(`ALTER TABLE tasks ADD COLUMN completed_at INTEGER`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_outcome ON tasks(outcome)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tasks_workspace_outcome ON tasks(workspace_id, outcome, completed_at)`);
        }
    },
    {
        id: '027_enhanced_projects',
        up: (db) => {
            const hasProjects = db
                .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'projects'`)
                .get();
            if (!(hasProjects === null || hasProjects === void 0 ? void 0 : hasProjects.ok))
                return;
            const cols = db.prepare(`PRAGMA table_info(projects)`).all();
            const hasCol = (name) => cols.some((c) => c.name === name);
            if (!hasCol('github_repo'))
                db.exec(`ALTER TABLE projects ADD COLUMN github_repo TEXT`);
            if (!hasCol('deadline'))
                db.exec(`ALTER TABLE projects ADD COLUMN deadline INTEGER`);
            if (!hasCol('color'))
                db.exec(`ALTER TABLE projects ADD COLUMN color TEXT`);
            if (!hasCol('metadata'))
                db.exec(`ALTER TABLE projects ADD COLUMN metadata TEXT`);
            db.exec(`
        CREATE TABLE IF NOT EXISTS project_agent_assignments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id INTEGER NOT NULL,
          agent_name TEXT NOT NULL,
          role TEXT DEFAULT 'member',
          assigned_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          UNIQUE(project_id, agent_name)
        );
        CREATE INDEX IF NOT EXISTS idx_paa_project ON project_agent_assignments(project_id);
        CREATE INDEX IF NOT EXISTS idx_paa_agent ON project_agent_assignments(agent_name);
      `);
        }
    },
    {
        id: '028_github_sync_v2',
        up: (db) => {
            // Tasks: promote GitHub fields from metadata JSON to proper columns
            const taskCols = db.prepare(`PRAGMA table_info(tasks)`).all();
            const hasTaskCol = (name) => taskCols.some((c) => c.name === name);
            if (!hasTaskCol('github_issue_number'))
                db.exec(`ALTER TABLE tasks ADD COLUMN github_issue_number INTEGER`);
            if (!hasTaskCol('github_repo'))
                db.exec(`ALTER TABLE tasks ADD COLUMN github_repo TEXT`);
            if (!hasTaskCol('github_synced_at'))
                db.exec(`ALTER TABLE tasks ADD COLUMN github_synced_at INTEGER`);
            if (!hasTaskCol('github_branch'))
                db.exec(`ALTER TABLE tasks ADD COLUMN github_branch TEXT`);
            if (!hasTaskCol('github_pr_number'))
                db.exec(`ALTER TABLE tasks ADD COLUMN github_pr_number INTEGER`);
            if (!hasTaskCol('github_pr_state'))
                db.exec(`ALTER TABLE tasks ADD COLUMN github_pr_state TEXT`);
            // Unique index for dedup (partial — only rows with issue numbers)
            db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_github_issue
          ON tasks(workspace_id, github_repo, github_issue_number)
          WHERE github_issue_number IS NOT NULL
      `);
            // Projects: sync control columns
            const projCols = db.prepare(`PRAGMA table_info(projects)`).all();
            const hasProjCol = (name) => projCols.some((c) => c.name === name);
            if (!hasProjCol('github_sync_enabled'))
                db.exec(`ALTER TABLE projects ADD COLUMN github_sync_enabled INTEGER NOT NULL DEFAULT 0`);
            if (!hasProjCol('github_labels_initialized'))
                db.exec(`ALTER TABLE projects ADD COLUMN github_labels_initialized INTEGER NOT NULL DEFAULT 0`);
            if (!hasProjCol('github_default_branch'))
                db.exec(`ALTER TABLE projects ADD COLUMN github_default_branch TEXT DEFAULT 'main'`);
            // Enhanced sync history columns
            const syncCols = db.prepare(`PRAGMA table_info(github_syncs)`).all();
            const hasSyncCol = (name) => syncCols.some((c) => c.name === name);
            if (!hasSyncCol('project_id'))
                db.exec(`ALTER TABLE github_syncs ADD COLUMN project_id INTEGER`);
            if (!hasSyncCol('changes_pushed'))
                db.exec(`ALTER TABLE github_syncs ADD COLUMN changes_pushed INTEGER NOT NULL DEFAULT 0`);
            if (!hasSyncCol('changes_pulled'))
                db.exec(`ALTER TABLE github_syncs ADD COLUMN changes_pulled INTEGER NOT NULL DEFAULT 0`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_github_syncs_project ON github_syncs(project_id)`);
            // Data migration: copy existing metadata JSON values into new columns
            db.exec(`
        UPDATE tasks
        SET github_repo = json_extract(metadata, '$.github_repo'),
            github_issue_number = json_extract(metadata, '$.github_issue_number'),
            github_synced_at = CAST(strftime('%s', json_extract(metadata, '$.github_synced_at')) AS INTEGER)
        WHERE json_extract(metadata, '$.github_repo') IS NOT NULL
          AND github_repo IS NULL
      `);
        }
    },
    {
        id: '029_link_workspaces_to_tenants',
        up: (db) => {
            var _a;
            const hasWorkspaces = db
                .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'workspaces'`)
                .get();
            if (!(hasWorkspaces === null || hasWorkspaces === void 0 ? void 0 : hasWorkspaces.ok))
                return;
            const hasTenants = db
                .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'tenants'`)
                .get();
            if (!(hasTenants === null || hasTenants === void 0 ? void 0 : hasTenants.ok))
                return;
            const workspaceCols = db.prepare(`PRAGMA table_info(workspaces)`).all();
            const hasWorkspaceTenantId = workspaceCols.some((c) => c.name === 'tenant_id');
            if (!hasWorkspaceTenantId) {
                db.exec(`ALTER TABLE workspaces ADD COLUMN tenant_id INTEGER`);
            }
            const tenantCount = ((_a = db.prepare(`SELECT COUNT(*) as c FROM tenants`).get()) === null || _a === void 0 ? void 0 : _a.c) || 0;
            let defaultTenantId;
            if (tenantCount > 0) {
                const existing = db.prepare(`
          SELECT id
          FROM tenants
          ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, id ASC
          LIMIT 1
        `).get();
                if (!(existing === null || existing === void 0 ? void 0 : existing.id))
                    throw new Error('Failed to resolve default tenant');
                defaultTenantId = existing.id;
            }
            else {
                const rawHost = String(process.env.MC_HOSTNAME || 'default').trim().toLowerCase();
                const slug = rawHost.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'default';
                const linuxUser = (String(process.env.USER || 'local').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') || 'local').slice(0, 30);
                const home = String(process.env.HOME || '/tmp').trim() || '/tmp';
                const insert = db.prepare(`
          INSERT INTO tenants (slug, display_name, linux_user, plan_tier, status, openclaw_home, workspace_root, config, created_by, owner_gateway)
          VALUES (?, ?, ?, 'standard', 'active', ?, ?, '{}', 'system', ?)
        `).run(slug, 'Local Owner', linuxUser, `${home}/.openclaw`, `${home}/workspace`, process.env.MC_DEFAULT_OWNER_GATEWAY || process.env.MC_DEFAULT_GATEWAY_NAME || 'primary');
                defaultTenantId = Number(insert.lastInsertRowid);
            }
            db.prepare(`UPDATE workspaces SET tenant_id = ? WHERE tenant_id IS NULL`).run(defaultTenantId);
            // Ensure session rows can carry tenant context derived from workspace.
            const sessionCols = db.prepare(`PRAGMA table_info(user_sessions)`).all();
            if (!sessionCols.some((c) => c.name === 'tenant_id')) {
                db.exec(`ALTER TABLE user_sessions ADD COLUMN tenant_id INTEGER`);
            }
            db.exec(`
        UPDATE user_sessions
        SET tenant_id = (
          SELECT w.tenant_id
          FROM users u
          JOIN workspaces w ON w.id = COALESCE(user_sessions.workspace_id, u.workspace_id, 1)
          WHERE u.id = user_sessions.user_id
          LIMIT 1
        )
        WHERE tenant_id IS NULL
      `);
            db.prepare(`UPDATE user_sessions SET tenant_id = ? WHERE tenant_id IS NULL`).run(defaultTenantId);
            const workspaceFk = db.prepare(`PRAGMA foreign_key_list(workspaces)`).all();
            const hasTenantFk = workspaceFk.some((fk) => fk.table === 'tenants' && fk.from === 'tenant_id' && fk.to === 'id');
            const tenantCol = db.prepare(`PRAGMA table_info(workspaces)`).all().find((c) => c.name === 'tenant_id');
            const tenantColNotNull = (tenantCol === null || tenantCol === void 0 ? void 0 : tenantCol.notnull) === 1;
            if (!hasTenantFk || !tenantColNotNull) {
                db.exec(`ALTER TABLE workspaces RENAME TO workspaces__legacy`);
                db.exec(`
          CREATE TABLE workspaces (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            tenant_id INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (unixepoch()),
            updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
            FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
          )
        `);
                db.prepare(`
          INSERT INTO workspaces (id, slug, name, tenant_id, created_at, updated_at)
          SELECT id, slug, name, COALESCE(tenant_id, ?), created_at, updated_at
          FROM workspaces__legacy
        `).run(defaultTenantId);
                db.exec(`DROP TABLE workspaces__legacy`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_workspaces_slug ON workspaces(slug)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_workspaces_tenant_id ON workspaces(tenant_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_tenant_id ON user_sessions(tenant_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_user_sessions_workspace_tenant ON user_sessions(workspace_id, tenant_id)`);
        }
    },
    {
        id: '032_adapter_configs',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS adapter_configs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          workspace_id INTEGER NOT NULL,
          framework TEXT NOT NULL,
          config TEXT DEFAULT '{}',
          enabled INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )
      `);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_adapter_configs_workspace_framework ON adapter_configs(workspace_id, framework)`);
        }
    },
    {
        id: '033_skills',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS skills (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          source TEXT NOT NULL,
          path TEXT NOT NULL,
          description TEXT,
          content_hash TEXT,
          registry_slug TEXT,
          registry_version TEXT,
          security_status TEXT DEFAULT 'unchecked',
          installed_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(source, name)
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_source ON skills(source)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_skills_registry_slug ON skills(registry_slug)`);
        }
    },
    {
        id: '034_agents_source',
        up(db) {
            const cols = db.prepare(`PRAGMA table_info(agents)`).all();
            if (!cols.some(c => c.name === 'source')) {
                db.exec(`ALTER TABLE agents ADD COLUMN source TEXT DEFAULT 'manual'`);
            }
            if (!cols.some(c => c.name === 'content_hash')) {
                db.exec(`ALTER TABLE agents ADD COLUMN content_hash TEXT`);
            }
            if (!cols.some(c => c.name === 'workspace_path')) {
                db.exec(`ALTER TABLE agents ADD COLUMN workspace_path TEXT`);
            }
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agents_source ON agents(source)`);
        }
    },
    {
        id: '035_api_keys_v2',
        up(db) {
            // Previous migrations (027/030) may have created an api_keys table with a different schema.
            // Drop and recreate with the full user-scoped schema.
            const existing = db
                .prepare(`SELECT 1 as ok FROM sqlite_master WHERE type = 'table' AND name = 'api_keys'`)
                .get();
            if (existing === null || existing === void 0 ? void 0 : existing.ok) {
                db.exec(`DROP TABLE api_keys`);
            }
            db.exec(`
        CREATE TABLE api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          label TEXT NOT NULL,
          key_prefix TEXT NOT NULL,
          key_hash TEXT NOT NULL UNIQUE,
          role TEXT NOT NULL DEFAULT 'viewer',
          scopes TEXT,
          expires_at INTEGER,
          last_used_at INTEGER,
          last_used_ip TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          tenant_id INTEGER NOT NULL DEFAULT 1,
          is_revoked INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_key_hash ON api_keys(key_hash)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_workspace_id ON api_keys(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix)`);
        }
    },
    {
        id: '036_recurring_tasks_index',
        up(db) {
            // Index to efficiently find recurring task templates
            db.exec(`
        CREATE INDEX IF NOT EXISTS idx_tasks_recurring
        ON tasks(workspace_id)
        WHERE json_extract(metadata, '$.recurrence.enabled') = 1
      `);
        }
    },
    {
        id: '037_security_audit',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS security_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          event_type TEXT NOT NULL,
          severity TEXT NOT NULL DEFAULT 'info',
          source TEXT,
          agent_name TEXT,
          detail TEXT,
          ip_address TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          tenant_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_event_type ON security_events(event_type)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_severity ON security_events(severity)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_created_at ON security_events(created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_agent_name ON security_events(agent_name)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_security_events_workspace_id ON security_events(workspace_id)`);
            db.exec(`
        CREATE TABLE IF NOT EXISTS agent_trust_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          trust_score REAL NOT NULL DEFAULT 1.0,
          auth_failures INTEGER NOT NULL DEFAULT 0,
          injection_attempts INTEGER NOT NULL DEFAULT 0,
          rate_limit_hits INTEGER NOT NULL DEFAULT 0,
          secret_exposures INTEGER NOT NULL DEFAULT 0,
          successful_tasks INTEGER NOT NULL DEFAULT 0,
          failed_tasks INTEGER NOT NULL DEFAULT 0,
          last_anomaly_at INTEGER,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(agent_name, workspace_id)
        )
      `);
            db.exec(`
        CREATE TABLE IF NOT EXISTS mcp_call_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT,
          mcp_server TEXT,
          tool_name TEXT,
          success INTEGER NOT NULL DEFAULT 1,
          duration_ms INTEGER,
          error TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_call_log_agent_name ON mcp_call_log(agent_name)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_call_log_created_at ON mcp_call_log(created_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_mcp_call_log_tool_name ON mcp_call_log(tool_name)`);
        }
    },
    {
        id: '038_agent_evals',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS eval_runs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          eval_layer TEXT NOT NULL,
          score REAL,
          passed INTEGER,
          detail TEXT,
          golden_dataset_id INTEGER,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_runs_agent_name ON eval_runs(agent_name)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_runs_eval_layer ON eval_runs(eval_layer)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_runs_created_at ON eval_runs(created_at)`);
            db.exec(`
        CREATE TABLE IF NOT EXISTS eval_golden_sets (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          description TEXT,
          entries TEXT NOT NULL DEFAULT '[]',
          created_by TEXT,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(name, workspace_id)
        )
      `);
            db.exec(`
        CREATE TABLE IF NOT EXISTS eval_traces (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_name TEXT NOT NULL,
          task_id INTEGER,
          trace TEXT NOT NULL DEFAULT '[]',
          convergence_score REAL,
          total_steps INTEGER,
          optimal_steps INTEGER,
          workspace_id INTEGER NOT NULL DEFAULT 1,
          created_at INTEGER NOT NULL DEFAULT (unixepoch())
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_traces_agent_name ON eval_traces(agent_name)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_eval_traces_task_id ON eval_traces(task_id)`);
        }
    },
    {
        id: '039_session_costs',
        up(db) {
            const columns = db.prepare(`PRAGMA table_info(token_usage)`).all();
            const existing = new Set(columns.map((c) => c.name));
            if (!existing.has('cost_usd')) {
                db.exec(`ALTER TABLE token_usage ADD COLUMN cost_usd REAL`);
            }
            if (!existing.has('agent_name')) {
                db.exec(`ALTER TABLE token_usage ADD COLUMN agent_name TEXT`);
            }
            if (!existing.has('task_id')) {
                db.exec(`ALTER TABLE token_usage ADD COLUMN task_id INTEGER`);
            }
        }
    },
    {
        id: '040_agent_api_keys',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS agent_api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          agent_id INTEGER NOT NULL,
          workspace_id INTEGER NOT NULL DEFAULT 1,

          name TEXT NOT NULL,
          key_hash TEXT NOT NULL,
          key_prefix TEXT NOT NULL,
          scopes TEXT NOT NULL DEFAULT '[]',
          expires_at INTEGER,
          revoked_at INTEGER,
          last_used_at INTEGER,
          created_by TEXT,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(workspace_id, key_hash)
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_agent_id ON agent_api_keys(agent_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_workspace_id ON agent_api_keys(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_expires_at ON agent_api_keys(expires_at)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_revoked_at ON agent_api_keys(revoked_at)`);
        }
    },
    {
        id: '041_gateway_health_logs',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS gateway_health_logs (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          gateway_id INTEGER NOT NULL,
          status TEXT NOT NULL,
          latency INTEGER,
          probed_at INTEGER NOT NULL DEFAULT (unixepoch()),
          error TEXT
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gateway_health_logs_gateway_id ON gateway_health_logs(gateway_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_gateway_health_logs_probed_at ON gateway_health_logs(probed_at)`);
        }
    },
    {
        id: '042_task_dependencies',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS task_dependencies (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          task_id INTEGER NOT NULL,
          depends_on_task_id INTEGER NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE,
          UNIQUE(task_id, depends_on_task_id)
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_task_deps_task_id ON task_dependencies(task_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_dependencies(depends_on_task_id)`);
        }
    },
    {
        id: '043_multi_tenant_auth',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_memberships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          tenant_id INTEGER NOT NULL,
          workspace_id INTEGER NOT NULL,
          role TEXT NOT NULL DEFAULT 'viewer',
          status TEXT NOT NULL DEFAULT 'active',
          is_default INTEGER NOT NULL DEFAULT 0,
          invited_by INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          UNIQUE(user_id, workspace_id),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tenant_memberships_user_id ON tenant_memberships(user_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tenant_memberships_tenant_id ON tenant_memberships(tenant_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tenant_memberships_workspace_id ON tenant_memberships(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_tenant_memberships_status ON tenant_memberships(status)`);
            db.exec(`
        CREATE TABLE IF NOT EXISTS auth_invites (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL,
          tenant_id INTEGER NOT NULL,
          workspace_id INTEGER NOT NULL,
          role TEXT NOT NULL DEFAULT 'viewer',
          token_hash TEXT NOT NULL UNIQUE,
          token_hint TEXT NOT NULL,
          invited_by_user_id INTEGER,
          accepted_by_user_id INTEGER,
          expires_at INTEGER NOT NULL,
          accepted_at INTEGER,
          revoked_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (invited_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
          FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_invites_email ON auth_invites(email)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_invites_tenant_id ON auth_invites(tenant_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_invites_workspace_id ON auth_invites(workspace_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_auth_invites_expires_at ON auth_invites(expires_at)`);
            const apiKeyCols = db.prepare(`PRAGMA table_info(api_keys)`).all();
            const hasApiKeyTenantId = apiKeyCols.some((col) => col.name === 'tenant_id');
            if (!hasApiKeyTenantId) {
                db.exec(`ALTER TABLE api_keys ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1`);
            }
            db.exec(`
        UPDATE api_keys
        SET tenant_id = COALESCE(
          tenant_id,
          (
            SELECT w.tenant_id
            FROM workspaces w
            WHERE w.id = api_keys.workspace_id
            LIMIT 1
          ),
          1
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_api_keys_tenant_id ON api_keys(tenant_id)`);
            const agentKeyCols = db.prepare(`PRAGMA table_info(agent_api_keys)`).all();
            const hasAgentKeyTenantId = agentKeyCols.some((col) => col.name === 'tenant_id');
            if (!hasAgentKeyTenantId) {
                db.exec(`ALTER TABLE agent_api_keys ADD COLUMN tenant_id INTEGER`);
            }
            db.exec(`
        UPDATE agent_api_keys
        SET tenant_id = COALESCE(
          tenant_id,
          (
            SELECT w.tenant_id
            FROM workspaces w
            WHERE w.id = agent_api_keys.workspace_id
            LIMIT 1
          ),
          1
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_agent_api_keys_tenant_id ON agent_api_keys(tenant_id)`);
            const membershipUsers = db.prepare(`
        SELECT
          u.id AS user_id,
          COALESCE(u.workspace_id, 1) AS workspace_id,
          COALESCE(w.tenant_id, 1) AS tenant_id,
          COALESCE(NULLIF(u.role, ''), 'operator') AS role
        FROM users u
        LEFT JOIN workspaces w ON w.id = COALESCE(u.workspace_id, 1)
      `).all();
            const defaultCounts = new Map();
            const hasMembershipRows = db.prepare(`SELECT COUNT(*) AS count FROM tenant_memberships`).get().count > 0;
            if (!hasMembershipRows) {
                for (const row of membershipUsers) {
                    const isDefault = defaultCounts.has(row.user_id) ? 0 : 1;
                    defaultCounts.set(row.user_id, true);
                    db.prepare(`
            INSERT OR IGNORE INTO tenant_memberships (
              user_id, tenant_id, workspace_id, role, status, is_default, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'active', ?, unixepoch(), unixepoch())
          `).run(row.user_id, row.tenant_id, row.workspace_id, row.role, isDefault);
                }
            }
            const localTenant = db.prepare(`
        SELECT id, display_name, linux_user
        FROM tenants
        ORDER BY id ASC
        LIMIT 1
      `).get();
            if (localTenant) {
                const defaultWorkspace = db.prepare(`
          SELECT id, name
          FROM workspaces
          WHERE tenant_id = ? AND slug = 'default'
          LIMIT 1
        `).get(localTenant.id);
                if (defaultWorkspace && defaultWorkspace.name === 'Default Workspace') {
                    const ownerUser = db.prepare(`
            SELECT display_name
            FROM users
            ORDER BY CASE WHEN id = 1 THEN 0 ELSE 1 END, id ASC
            LIMIT 1
          `).get();
                    const preferredName = ((ownerUser === null || ownerUser === void 0 ? void 0 : ownerUser.display_name) && ownerUser.display_name.trim()) ||
                        (localTenant.display_name && localTenant.display_name.trim()) ||
                        (localTenant.linux_user && localTenant.linux_user.trim()) ||
                        'Owner';
                    db.prepare(`
            UPDATE workspaces
            SET name = ?, updated_at = unixepoch()
            WHERE id = ?
          `).run(`${preferredName} Workspace`, defaultWorkspace.id);
                }
            }
        }
    },
    {
        id: '045_password_reset_tokens',
        up(db) {
            db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL,
          token_hash TEXT NOT NULL UNIQUE,
          expires_at INTEGER NOT NULL,
          used_at INTEGER,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
      `);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_prt_token_hash ON password_reset_tokens(token_hash)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_prt_user_id ON password_reset_tokens(user_id)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_prt_expires_at ON password_reset_tokens(expires_at)`);
        }
    },
    {
        id: '046_add_users_orgs_and_multi_tenancy',
        up: (db) => {
            // Drop old users table and related sessions if they exist to prevent conflicts
            const dropTableIfExists = (tableName) => {
                const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
                if (tableExists) {
                    db.exec(`DROP TABLE ${tableName}`);
                    console.log(`Dropped existing table: ${tableName}`);
                }
            };
            dropTableIfExists('user_sessions');
            dropTableIfExists('users');
            dropTableIfExists('organizations'); // Ensure organizations is also dropped if it exists from a previous failed attempt
            // 1. Create Organizations Table
            db.exec(`
        CREATE TABLE organizations (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL UNIQUE,
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          owner_user_id INTEGER,
          FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL
        );
      `);
            // 2. Create Users Table
            db.exec(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          email TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          name TEXT,
          organization_id INTEGER,
          role TEXT NOT NULL DEFAULT 'user',
          created_at INTEGER NOT NULL DEFAULT (unixepoch()),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
        );
      `);
            // 3. Add organization_id to existing tables and set default
            const tablesToAlter = [
                'tasks', 'agents', 'comments', 'activities', 'notifications',
                'task_subscriptions', 'standup_reports', 'quality_reviews', 'gateway_health_logs',
            ];
            for (const tableName of tablesToAlter) {
                // Check if table exists before altering
                const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(tableName);
                if (tableExists) {
                    const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
                    if (!cols.some((c) => c.name === 'organization_id')) {
                        db.exec(`ALTER TABLE ${tableName} ADD COLUMN organization_id INTEGER NOT NULL DEFAULT 1`);
                        db.exec(`UPDATE ${tableName} SET organization_id = 1 WHERE organization_id IS NULL`); // Ensure existing rows have a default
                        db.exec(`CREATE INDEX IF NOT EXISTS idx_${tableName}_organization_id ON ${tableName}(organization_id)`);
                        db.exec(`
              CREATE TRIGGER IF NOT EXISTS fk_organization_id_${tableName}
              AFTER UPDATE OF organization_id ON ${tableName}
              FOR EACH ROW WHEN NEW.organization_id IS NOT NULL AND (SELECT id FROM organizations WHERE id = NEW.organization_id) IS NULL
              BEGIN
                SELECT RAISE(ABORT, 'FOREIGN KEY constraint failed: organization_id not found in organizations table');
              END;
            `);
                    }
                }
            }
            // Add indexes for new tables
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name)`);
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email)`);
            db.exec(`CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id)`);
        }
    }
];
export function runMigrations(db) {
    db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
    const applied = new Set(db.prepare('SELECT id FROM schema_migrations').all().map((row) => row.id));
    for (const migration of [...migrations, ...extraMigrations]) {
        if (applied.has(migration.id))
            continue;
        db.transaction(() => {
            migration.up(db);
            db.prepare('INSERT OR IGNORE INTO schema_migrations (id) VALUES (?)').run(migration.id);
        })();
    }
}
