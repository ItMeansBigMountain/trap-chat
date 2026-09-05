variable "azure_subscription_id" {
  type      = string
  sensitive = true
}

variable "location" {
  type    = string
  default = "East US 2"
}

variable "resource_group_location" {
  type    = string
  default = "East US"
}

variable "resource_group_name" {
  type    = string
  default = "rg-trap-chat-prod"
}

variable "static_web_app_name" {
  type    = string
  default = "stapp-trap-chat-prod"
}

variable "app_service_plan_name" {
  type    = string
  default = "asp-trap-chat-prod"
}

variable "app_service_name" {
  type    = string
  default = "trap-chat-api"
}

# F1 is intentionally used for the public Azure preview because this
# subscription has no B1 quota. It is not suitable for production realtime
# traffic; promote only after quota is granted and this is raised to B1+.
variable "app_service_sku" {
  type    = string
  default = "F1"
}

variable "frontend_origin" {
  type    = string
  default = "https://yellow-ground-05896030f.6.azurestaticapps.net"
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
