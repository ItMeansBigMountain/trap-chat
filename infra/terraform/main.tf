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

  lifecycle {
    ignore_changes = [repository_url, repository_branch]
  }
}

resource "azurerm_consumption_budget_resource_group" "trap_chat" {
  count             = length(var.budget_contact_emails) > 0 ? 1 : 0
  name              = "budget-trap-chat"
  resource_group_id = azurerm_resource_group.trap_chat.id
  amount            = var.monthly_budget_amount
  time_grain        = "Monthly"

  time_period {
    start_date = "2026-09-01T00:00:00Z"
  }

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

resource "azurerm_service_plan" "backend" {
  name                = var.app_service_plan_name
  location            = azurerm_resource_group.trap_chat.location
  resource_group_name = azurerm_resource_group.trap_chat.name
  os_type             = "Linux"
  sku_name            = var.app_service_sku
  tags                = local.tags
}

resource "azurerm_linux_web_app" "backend" {
  name                = var.app_service_name
  location            = azurerm_resource_group.trap_chat.location
  resource_group_name = azurerm_resource_group.trap_chat.name
  service_plan_id     = azurerm_service_plan.backend.id
  https_only          = true

  site_config {
    always_on          = false
    http2_enabled      = true
    websockets_enabled = true
    app_command_line   = "gunicorn --worker-class gthread --threads 100 --timeout 120 --bind 0.0.0.0:\u0024PORT app:app"

    application_stack {
      python_version = "3.11"
    }

    cors {
      allowed_origins     = [var.frontend_origin]
      support_credentials = true
    }
  }

  app_settings = {
    SCM_DO_BUILD_DURING_DEPLOYMENT = "true"
    DATABASE_URL                   = "sqlite:////home/data/trapchat.db"
    FRONTEND_ORIGIN                = var.frontend_origin
  }

  tags = local.tags

  lifecycle {
    # Deployment injects SECRET_KEY without placing it in Terraform state.
    ignore_changes = [app_settings["SECRET_KEY"]]
  }
}
