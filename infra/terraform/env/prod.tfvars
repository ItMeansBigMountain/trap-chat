azure_subscription_id   = "4f070006-f5e7-471d-a859-b15a2a8ee406"
resource_group_location = "Central US"
resource_group_name     = "rg-trap-chat-prod"
static_web_app_name     = "stapp-trap-chat-prod"
monthly_budget_amount   = 10
budget_contact_emails   = []

# Who can reach /admin. These must be real Trap Chat accounts: the panel
# checks the name is on this list AND that the account's own password is
# right. Empty would disable the panel entirely.
admin_usernames = "affan"
