// Drawesome backend: sign-in (email codes, Google, Microsoft) and drawing sync.
// Same shape as Artha's backend: Cosmos DB serverless + Blob Storage + Azure
// Communication Services Email + Key Vault, behind a pay-per-use Function App. At a
// personal app's scale this stays inside the free grants, so the running cost is ~$0.
//
// The Function App runs on the Flex Consumption plan (Node 22): the older Linux
// Consumption plan no longer gets new Node versions and is being retired.
//
// Deploy (full walkthrough in backend/README.md):
//   az group create --name drawesome-rg --location <region>
//   az deployment group create --resource-group drawesome-rg --template-file infra/main.bicep \
//     --parameters namePrefix=drawesome<initials> deployerPrincipalId=$(az ad signed-in-user show --query id -o tsv)

@description('Short, globally-unique-ish prefix for resource names (storage, Cosmos and Key Vault names are global). Letters and digits only.')
@minLength(3)
@maxLength(14)
param namePrefix string

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Browser origins allowed to call the API: the deployed site and the local dev server.')
param allowedOrigins array = [
  'https://anandd512.github.io'
  'http://localhost:5173'
]

@description('Google OAuth client ID (public). Leave empty to hide "Continue with Google".')
param googleClientId string = ''

@description('Microsoft Entra application (client) ID (public). Leave empty to hide "Continue with Microsoft".')
param microsoftClientId string = ''

@description('Object id of the person deploying, granted rights to set the session-key secret. Optional.')
param deployerPrincipalId string = ''

var storageAccountName = toLower('${namePrefix}st')
var cosmosAccountName = toLower('${namePrefix}-cosmos')
var emailServiceName = toLower('${namePrefix}-email')
var communicationServiceName = toLower('${namePrefix}-acs')
var keyVaultName = toLower('${namePrefix}-kv')
var functionAppName = toLower('${namePrefix}-func')
var appInsightsName = toLower('${namePrefix}-ai')
var logAnalyticsName = toLower('${namePrefix}-logs')
var planName = toLower('${namePrefix}-plan')
var deploymentContainerName = 'deployments'

// ---------------------------------------------------------------- Storage
// One account for everything: the Functions host, the deployment package (Flex), and
// the `scenes` container holding each user's drawings. No public blob access; the
// Function App reaches it with its managed identity.
resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageAccountName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource scenesContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'scenes'
  properties: { publicAccess: 'None' }
}

resource deploymentContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainerName
  properties: { publicAccess: 'None' }
}

// ---------------------------------------------------------------- Cosmos DB
resource cosmos 'Microsoft.DocumentDB/databaseAccounts@2024-05-15' = {
  name: cosmosAccountName
  location: location
  kind: 'GlobalDocumentDB'
  properties: {
    databaseAccountOfferType: 'Standard'
    capabilities: [{ name: 'EnableServerless' }]
    locations: [{ locationName: location, failoverPriority: 0 }]
    consistencyPolicy: { defaultConsistencyLevel: 'Session' }
  }
}

resource cosmosDb 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases@2024-05-15' = {
  parent: cosmos
  name: 'drawesome'
  properties: { resource: { id: 'drawesome' } }
}

resource usersContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'users'
  properties: { resource: { id: 'users', partitionKey: { paths: ['/id'], kind: 'Hash' } } }
}

resource identitiesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'identities'
  properties: { resource: { id: 'identities', partitionKey: { paths: ['/id'], kind: 'Hash' } } }
}

// Pending sign-in codes and rate-limit counters. `defaultTtl: -1` turns TTL on without
// expiring anything by default; each document sets its own `ttl`, so Cosmos sweeps
// stale codes itself instead of needing a cleanup job.
resource codesContainer 'Microsoft.DocumentDB/databaseAccounts/sqlDatabases/containers@2024-05-15' = {
  parent: cosmosDb
  name: 'codes'
  properties: {
    resource: {
      id: 'codes'
      partitionKey: { paths: ['/id'], kind: 'Hash' }
      defaultTtl: -1
    }
  }
}

// ---------------------------------------------------------------- Email (ACS)
// Free "Azure Managed Domain" sender: DoNotReply@<guid>.azurecomm.net, with SPF/DKIM/
// DMARC already in place. No domain purchase or DNS records.
resource emailService 'Microsoft.Communication/emailServices@2023-04-01' = {
  name: emailServiceName
  location: 'global'
  properties: { dataLocation: 'United States' }
}

resource emailDomain 'Microsoft.Communication/emailServices/domains@2023-04-01' = {
  parent: emailService
  name: 'AzureManagedDomain'
  location: 'global'
  properties: { domainManagement: 'AzureManaged' }
}

resource communicationService 'Microsoft.Communication/communicationServices@2023-04-01' = {
  name: communicationServiceName
  location: 'global'
  properties: {
    dataLocation: 'United States'
    linkedDomains: [emailDomain.id]
  }
}

// ---------------------------------------------------------------- Key Vault
resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    sku: { family: 'A', name: 'standard' }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
  }
}

// Written by this template, so there is no manual copy-paste step for it.
resource acsSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'acs-connection-string'
  properties: { value: communicationService.listKeys().primaryConnectionString }
}
// `session-signing-key` is set once by hand (see README): a template can't generate a
// random value that stays the same on every redeploy, and changing it signs everyone out.

// ---------------------------------------------------------------- Monitoring
resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

// ---------------------------------------------------------------- Function App
resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionAppName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      cors: { allowedOrigins: allowedOrigins }
      // Note: this list replaces every app setting on each deployment. Add new
      // settings here rather than with `az functionapp config appsettings set`.
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
        { name: 'COSMOS_ENDPOINT', value: cosmos.properties.documentEndpoint }
        { name: 'COSMOS_DATABASE', value: 'drawesome' }
        { name: 'SCENES_STORAGE_ACCOUNT_NAME', value: storage.name }
        { name: 'ACS_SENDER_ADDRESS', value: 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}' }
        { name: 'GOOGLE_CLIENT_ID', value: googleClientId }
        { name: 'MICROSOFT_CLIENT_ID', value: microsoftClientId }
        // Secrets stay in Key Vault; the app reads them through its managed identity.
        { name: 'ACS_CONNECTION_STRING', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=acs-connection-string)' }
        { name: 'SESSION_SIGNING_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=session-signing-key)' }
      ]
    }
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainerName}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: 40
        instanceMemoryMB: 2048
      }
      runtime: { name: 'node', version: '22' }
    }
  }
}

// ---------------------------------------------------------------- Role assignments
var roles = {
  storageBlobDataOwner: 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
  storageQueueDataContributor: '974c5e8b-45b9-4653-ba55-5f855dd0fb88'
  storageTableDataContributor: '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'
  keyVaultSecretsUser: '4633458b-17de-408a-b874-0445c86b69e6'
  keyVaultSecretsOfficer: 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'
}

// Functions host storage, the deployment package and the `scenes` container.
resource storageRoleAssignments 'Microsoft.Authorization/roleAssignments@2022-04-01' = [
  for roleId in [roles.storageBlobDataOwner, roles.storageQueueDataContributor, roles.storageTableDataContributor]: {
    name: guid(storage.id, functionApp.id, roleId)
    scope: storage
    properties: {
      roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roleId)
      principalId: functionApp.identity.principalId
      principalType: 'ServicePrincipal'
    }
  }
]

resource keyVaultReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, functionApp.id, roles.keyVaultSecretsUser)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsUser)
    principalId: functionApp.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource keyVaultDeployer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(deployerPrincipalId)) {
  name: guid(keyVault.id, deployerPrincipalId, roles.keyVaultSecretsOfficer)
  scope: keyVault
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', roles.keyVaultSecretsOfficer)
    principalId: deployerPrincipalId
    principalType: 'User'
  }
}

// Cosmos data-plane access without a key (built-in "Cosmos DB Built-in Data Contributor").
resource cosmosDataContributor 'Microsoft.DocumentDB/databaseAccounts/sqlRoleAssignments@2024-05-15' = {
  parent: cosmos
  name: guid(cosmos.id, functionApp.id, 'data-contributor')
  properties: {
    roleDefinitionId: '${cosmos.id}/sqlRoleDefinitions/00000000-0000-0000-0000-000000000002'
    principalId: functionApp.identity.principalId
    scope: cosmos.id
  }
}

output functionAppName string = functionApp.name
output apiBaseUrl string = 'https://${functionApp.properties.defaultHostName}/api'
output keyVaultName string = keyVault.name
output cosmosAccountName string = cosmos.name
output storageAccountName string = storage.name
output emailSenderAddress string = 'DoNotReply@${emailDomain.properties.mailFromSenderDomain}'
