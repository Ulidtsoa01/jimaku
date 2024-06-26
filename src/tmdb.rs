use std::{str::FromStr, sync::OnceLock};

use regex::Regex;
use rusqlite::{types::FromSql, ToSql};
use serde::{Deserialize, Serialize};

use crate::{anilist::MediaTitle, borrowed::MaybeBorrowedString, japanese::is_japanese_char};

fn url_parser_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r#"https://(?:www\.)?themoviedb\.org/(tv|movie)/(\d+)(?:-[a-zA-Z0-9\-]+)?(/.*)?"#).unwrap()
    })
}

/// A TMDB ID.
///
/// These are scoped depending on the series.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Id {
    /// The type of the TMDB ID represents a TV series.
    Tv {
        /// The integer TMDB ID.
        id: u32,
    },
    /// The type of the TMDB ID represents a movie.
    Movie {
        /// The integer TMDB ID.
        id: u32,
    },
}

pub fn get_tmdb_id(url: &str) -> Option<Id> {
    let captures = url_parser_regex().captures(url)?;
    let kind = captures.get(1)?.as_str();
    let id = captures.get(2)?.as_str().parse().ok()?;
    match kind {
        "tv" => Some(Id::Tv { id }),
        "movie" => Some(Id::Movie { id }),
        _ => None,
    }
}

impl Id {
    pub fn url(&self) -> String {
        match self {
            Id::Tv { id } => format!("https://www.themoviedb.org/tv/{id}"),
            Id::Movie { id } => format!("https://www.themoviedb.org/movie/{id}"),
        }
    }

    fn api_url(&self) -> String {
        match self {
            Id::Tv { id } => format!("https://api.themoviedb.org/3/tv/{id}"),
            Id::Movie { id } => format!("https://api.themoviedb.org/3/movie/{id}"),
        }
    }

    /// Returns `true` if the id is [`Movie`].
    ///
    /// [`Movie`]: Id::Movie
    #[must_use]
    pub fn is_movie(&self) -> bool {
        matches!(self, Self::Movie { .. })
    }
}

impl Default for Id {
    fn default() -> Self {
        Self::Tv { id: 0 }
    }
}

impl std::fmt::Display for Id {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Id::Tv { id } => {
                f.write_str("tv:")?;
                id.fmt(f)
            }
            Id::Movie { id } => {
                f.write_str("movie:")?;
                id.fmt(f)
            }
        }
    }
}

impl FromStr for Id {
    type Err = InvalidId;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        let Some((key, value)) = s.split_once(':') else {
            return Err(InvalidId);
        };
        match key {
            "tv" => value.parse().map(|id| Self::Tv { id }).map_err(|_| InvalidId),
            "movie" => value.parse().map(|id| Self::Movie { id }).map_err(|_| InvalidId),
            _ => Err(InvalidId),
        }
    }
}

impl<'de> Deserialize<'de> for Id {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        MaybeBorrowedString::deserialize(deserializer)?
            .parse()
            .map_err(serde::de::Error::custom)
    }
}

impl Serialize for Id {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl ToSql for Id {
    fn to_sql(&self) -> rusqlite::Result<rusqlite::types::ToSqlOutput<'_>> {
        Ok(self.to_string().into())
    }
}

impl FromSql for Id {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        let value = String::column_result(value)?;
        value
            .parse::<Self>()
            .map_err(|e| rusqlite::types::FromSqlError::Other(Box::new(e)))
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct InvalidId;

impl std::fmt::Display for InvalidId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("invalid tmdb ID provided")
    }
}

impl std::error::Error for InvalidId {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
enum LangCode {
    Japanese,
    English,
    Other,
}

impl<'de> Deserialize<'de> for LangCode {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let value = MaybeBorrowedString::deserialize(deserializer)?;
        match value.as_str() {
            "JP" | "ja" => Ok(Self::Japanese),
            "US" | "GB" | "en" => Ok(Self::English),
            _ => Ok(Self::Other),
        }
    }
}

#[derive(Debug, Deserialize)]
struct AlternativeTitle {
    #[serde(rename = "iso_3166_1")]
    lang: LangCode,
    #[serde(deserialize_with = "crate::japanese::normalized_ascii_representation")]
    title: String,
    #[serde(rename = "type")]
    info: String,
}

impl AlternativeTitle {
    fn is_romaji(&self) -> bool {
        if self.lang != LangCode::Japanese {
            false
        } else {
            // This field is not consistent and depends heavily on the entry
            // Some examples are Romaji, romanji, Hepburn romanization, etc.
            // As a hack, just check if "roma" or "hepburn" is included in
            // the lowercased version of the string
            let lower = self.info.to_lowercase();
            lower.contains("roma") || lower.contains("hepburn") || (self.info.is_empty() && self.title.is_ascii())
        }
    }
}

#[derive(Debug, Deserialize)]
struct AlternativeTitles {
    #[serde(alias = "results")]
    titles: Vec<AlternativeTitle>,
}

impl AlternativeTitles {
    fn romaji(&self) -> Option<String> {
        self.titles.iter().find(|t| t.is_romaji()).map(|t| t.title.clone())
    }
}

#[derive(Debug, Deserialize)]
pub struct Info {
    #[serde(skip)]
    pub id: Id,
    adult: bool,
    original_language: LangCode,
    #[serde(alias = "original_name")]
    original_title: String,
    #[serde(
        alias = "name",
        deserialize_with = "crate::japanese::normalized_ascii_representation"
    )]
    title: String,
    alternative_titles: AlternativeTitles,
}

impl Info {
    pub fn titles(&self) -> MediaTitle {
        let romaji = self.alternative_titles.romaji();
        let english = if self.original_language == LangCode::English {
            Some(self.original_title.clone())
        } else if self.title.chars().all(|c| !is_japanese_char(c)) {
            Some(self.title.clone())
        } else {
            None
        };
        let native = if self.original_language == LangCode::Japanese {
            Some(self.original_title.clone())
        } else {
            self.alternative_titles
                .titles
                .iter()
                .find(|t| t.lang == LangCode::Japanese)
                .map(|t| t.title.clone())
        };
        let romaji = match romaji {
            Some(romaji) => romaji,
            None => match &english {
                Some(english) => english.clone(),
                None => self.original_title.clone(),
            },
        };
        MediaTitle {
            romaji,
            english,
            native,
        }
    }

    pub fn is_adult(&self) -> bool {
        self.adult
    }
}

#[derive(Debug, Deserialize)]
struct SearchResult {
    id: u32,
    media_type: String,
}

impl SearchResult {
    fn to_id(&self) -> Option<Id> {
        match self.media_type.as_str() {
            "tv" => Some(Id::Tv { id: self.id }),
            "movie" => Some(Id::Movie { id: self.id }),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct PagedSearchResults {
    results: Vec<SearchResult>,
}

pub async fn get_media_info(client: &reqwest::Client, api_key: &str, id: Id) -> anyhow::Result<Option<Info>> {
    let mut url = reqwest::Url::parse(&id.api_url())?;
    url.query_pairs_mut()
        .append_pair("append_to_response", "alternative_titles")
        .append_pair("language", "en-US")
        .append_pair("api_key", api_key);

    let resp = client.get(url).header("accept", "application/json").send().await?;

    if resp.status().as_u16() == 404 {
        return Ok(None);
    }

    let mut info = resp.error_for_status()?.json::<Info>().await?;
    info.id = id;
    Ok(Some(info))
}

pub async fn find_match(client: &reqwest::Client, api_key: &str, query: &str) -> anyhow::Result<Option<Info>> {
    let mut url = reqwest::Url::parse("https://api.themoviedb.org/3/search/multi")?;
    url.query_pairs_mut()
        .append_pair("query", query)
        .append_pair("page", "1")
        .append_pair("include_adult", "true")
        .append_pair("language", "en-US")
        .append_pair("api_key", api_key);

    let resp = client.get(url).header("accept", "application/json").send().await?;
    if !resp.status().is_success() {
        return Ok(None);
    }

    let mut info = resp.json::<PagedSearchResults>().await?.results;
    if info.is_empty() {
        Ok(None)
    } else {
        match info.swap_remove(0).to_id() {
            Some(id) => get_media_info(client, api_key, id).await,
            None => Ok(None),
        }
    }
}
