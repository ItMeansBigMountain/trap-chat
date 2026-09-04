output "resource_group_name" { value = azurerm_resource_group.trap_chat.name }
output "static_web_app_name" { value = azurerm_static_web_app.frontend.name }
output "static_web_app_hostname" { value = azurerm_static_web_app.frontend.default_host_name }
output "static_web_app_id" { value = azurerm_static_web_app.frontend.id }
