locals {
  tags = merge(var.tags, { Environment = "production" })
}

resource "azurerm_resource_group" "trap_chat" {
  name     = var.resource_group_name
  location = var.location
  tags     = local.tags
}

resource "azurerm_static_web_app" "frontend" {
  name                = var.static_web_app_name
  resource_group_name = azurerm_resource_group.trap_chat.name
  location            = var.location
  sku_tier            = "Free"
  sku_size            = "Free"
  tags                = local.tags
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
