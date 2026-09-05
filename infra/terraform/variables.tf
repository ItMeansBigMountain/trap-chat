variable "azure_subscription_id" {
  type      = string
  sensitive = true
}

variable "location" {
  type    = string
  default = "East US 2"
}

variable "resource_group_name" {
  type    = string
  default = "rg-trap-chat-prod"
}

variable "static_web_app_name" {
  type    = string
  default = "stapp-trap-chat-prod"
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
  }
}
