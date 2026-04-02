use serde::{Deserialize, Serialize};
use shared::extensions::settings::{
    ExtensionSettings, SettingsDeserializeExt, SettingsDeserializer, SettingsSerializeExt,
    SettingsSerializer,
};
use utoipa::ToSchema;

#[derive(ToSchema, Serialize, Deserialize, Clone)]
pub struct McvcSettingsData {
    pub mcjars_api_url: compact_str::CompactString,
    pub default_category: compact_str::CompactString,
}

impl Default for McvcSettingsData {
    fn default() -> Self {
        Self {
            mcjars_api_url: "https://mcjars.app".into(),
            default_category: "all".into(),
        }
    }
}

#[async_trait::async_trait]
impl SettingsSerializeExt for McvcSettingsData {
    async fn serialize(
        &self,
        serializer: SettingsSerializer,
    ) -> Result<SettingsSerializer, anyhow::Error> {
        Ok(serializer
            .write_raw_setting("mcjars_api_url", self.mcjars_api_url.clone())
            .write_raw_setting("default_category", self.default_category.clone()))
    }
}

pub struct McvcSettingsDeserializer;

#[async_trait::async_trait]
impl SettingsDeserializeExt for McvcSettingsDeserializer {
    async fn deserialize_boxed(
        &self,
        mut deserializer: SettingsDeserializer<'_>,
    ) -> Result<ExtensionSettings, anyhow::Error> {
        let defaults = McvcSettingsData::default();

        let mcjars_api_url = deserializer
            .take_raw_setting("mcjars_api_url")
            .unwrap_or(defaults.mcjars_api_url);

        let default_category = deserializer
            .take_raw_setting("default_category")
            .unwrap_or(defaults.default_category);

        Ok(Box::new(McvcSettingsData {
            mcjars_api_url,
            default_category,
        }))
    }
}
