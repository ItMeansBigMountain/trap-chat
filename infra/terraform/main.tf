locals {
  tags = merge(var.tags, { Environment = "production" })
}

resource "azurerm_resource_group" "trap_chat" {
  name     = var.resource_group_name
  location = var.resource_group_location
  tags     = local.tags
}

resource "azurerm_static_web_app" "frontend" {
  name                = var.static_web_app_name
  resource_group_name = azurerm_resource_group.trap_chat.name
  location            = var.location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags

  lifecycle { ignore_changes = [repository_url, repository_branch] }
}

resource "azurerm_consumption_budget_resource_group" "trap_chat" {
  count             = length(var.budget_contact_emails) > 0 ? 1 : 0
  name              = "budget-trap-chat"
  resource_group_id = azurerm_resource_group.trap_chat.id
  amount            = var.monthly_budget_amount
  time_grain        = "Monthly"
  time_period { start_date = "2026-09-01T00:00:00Z" }
  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.budget_contact_emails
  }
  notification {
    enabled        = true
    threshold      = 90
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_emails = var.budget_contact_emails
  }
}

resource "random_password" "backend_secret" {
  length  = 64
  special = true
}

resource "azurerm_storage_account" "backend" {
  name                     = var.backend_storage_account_name
  resource_group_name      = azurerm_resource_group.trap_chat.name
  location                 = azurerm_resource_group.trap_chat.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"
  tags                     = local.tags
}

resource "azurerm_storage_share" "backend_data" {
  name               = "trapchat-data"
  storage_account_id = azurerm_storage_account.backend.id
  quota              = 1
}

resource "azurerm_container_app_environment" "backend" {
  name                = var.container_app_environment_name
  location            = azurerm_resource_group.trap_chat.location
  resource_group_name = azurerm_resource_group.trap_chat.name
  tags                = local.tags
}

resource "azurerm_container_app_environment_storage" "backend_data" {
  name                         = "trapchat-data"
  container_app_environment_id = azurerm_container_app_environment.backend.id
  account_name                 = azurerm_storage_account.backend.name
  share_name                   = azurerm_storage_share.backend_data.name
  access_key                   = azurerm_storage_account.backend.primary_access_key
  access_mode                  = "ReadWrite"
}

resource "azurerm_container_app" "backend" {
  name                         = var.container_app_name
  container_app_environment_id = azurerm_container_app_environment.backend.id
  resource_group_name          = azurerm_resource_group.trap_chat.name
  revision_mode                = "Single"
  tags                         = local.tags

  secret {
    name  = "flask-secret-key"
    value = random_password.backend_secret.result
  }

  ingress {
    external_enabled           = true
    allow_insecure_connections = false
    target_port                = 8080
    transport                  = "auto"
    traffic_weight {
      latest_revision = true
      percentage      = 100
    }
  }

  template {
    min_replicas = 0
    max_replicas = 1

    container {
      name   = "backend"
      image  = var.backend_image
      cpu    = 0.25
      memory = "0.5Gi"

      env {
        name  = "DATABASE_URL"
        value = "sqlite:////data/trapchat.db"
      }
      env {
        name  = "FRONTEND_ORIGIN"
        value = var.frontend_origin
      }
      env {
        name        = "SECRET_KEY"
        secret_name = "flask-secret-key"
      }
      env {
        name  = "PORT"
        value = "8080"
      }

      volume_mounts {
        name = "backend-data"
        path = "/data"
      }

      liveness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/api/health"
      }
      readiness_probe {
        transport = "HTTP"
        port      = 8080
        path      = "/api/health"
      }
    }

    volume {
      name         = "backend-data"
      storage_name = azurerm_container_app_environment_storage.backend_data.name
      storage_type = "AzureFile"
    }
  }
}
