variable "azure_subscription_id" {
  type      = string
  sensitive = true
}
variable "resource_group_location" {
  # Every other resource reads azurerm_resource_group.trap_chat.location, so
  # this is the single place the region is set.
  type    = string
  default = "Central US"
}

variable "resource_group_name" {
  type    = string
  default = "rg-trap-chat-prod"
}
variable "static_web_app_name" {
  type    = string
  default = "stapp-trap-chat-prod"
}
variable "container_app_environment_name" {
  type    = string
  default = "cae-trap-chat-prod"
}
variable "container_app_name" {
  type    = string
  default = "trap-chat-api"
}
variable "backend_storage_account_name" {
  type    = string
  default = "trpchat4f070006f5"
}
variable "backend_image" {
  type    = string
  default = "ghcr.io/itmeansbigmountain/trap-chat-backend:latest"
}
variable "monthly_budget_amount" {
  type    = number
  default = 10
}
variable "budget_contact_emails" {
  type    = list(string)
  default = []
}
variable "tags" {
  type = map(string)
  default = {
    AppName        = "TrapChat"
    AppSlug        = "trap-chat"
    Project        = "TrapChat"
    ManagedBy      = "Terraform"
    IaC            = "Terraform"
    DeploymentTool = "GitHubActions"
    Repository     = "ItMeansBigMountain/trap-chat"
    CostGuard      = "free-tier"
    app            = "trap-chat"
    cost-center    = "free-tier"
    environment    = "production"
    owner          = "hermes"
  }
}
