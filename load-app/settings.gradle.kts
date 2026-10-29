// Load app (T62): build with the probe's wrapper, `probe-app/gradlew -p load-app assembleRelease`.
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "crewdroid-load"
