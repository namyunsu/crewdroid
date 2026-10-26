// Field Notes demo app (T48): build with the probe's wrapper, `probe-app/gradlew -p demo-app assembleDebug`.
pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
dependencyResolutionManagement { repositories { google(); mavenCentral() } }
rootProject.name = "crewdroid-demo"
