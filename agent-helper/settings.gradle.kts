// On-device agent helper (T52): build with the probe's wrapper, `probe-app/gradlew -p agent-helper assembleRelease`.
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "crewdroid-agent"
