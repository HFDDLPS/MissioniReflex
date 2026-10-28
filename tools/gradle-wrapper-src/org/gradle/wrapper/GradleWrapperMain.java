package org.gradle.wrapper;

import java.io.BufferedInputStream;
import java.io.BufferedOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/** Small project-local bootstrapper so this project can be opened without a preinstalled Gradle.
 * It downloads the exact distribution declared in gradle-wrapper.properties on first use. */
public final class GradleWrapperMain {
    private GradleWrapperMain() {}

    public static void main(String[] args) throws Exception {
        Path projectRoot = findProjectRoot();
        Path propsPath = projectRoot.resolve("gradle/wrapper/gradle-wrapper.properties");
        Properties properties = new Properties();
        try (InputStream input = Files.newInputStream(propsPath)) {
            properties.load(input);
        }
        String distributionUrl = properties.getProperty("distributionUrl");
        if (distributionUrl == null || !distributionUrl.startsWith("https://")) {
            throw new IllegalStateException("distributionUrl HTTPS non configurato in " + propsPath);
        }

        String fileName = distributionUrl.substring(distributionUrl.lastIndexOf('/') + 1);
        String rootName = fileName.replaceFirst("-(bin|all)\\.zip$", "");
        Path cacheBase = Paths.get(System.getProperty("user.home"), ".gradle", "wrapper", "dists",
                "missionireflex", rootName);
        Path distributionHome = cacheBase.resolve(rootName);
        Path gradleScript = distributionHome.resolve("bin").resolve(isWindows() ? "gradle.bat" : "gradle");

        if (!Files.isRegularFile(gradleScript)) {
            Files.createDirectories(cacheBase);
            Path archive = cacheBase.resolve(fileName);
            if (!Files.isRegularFile(archive) || Files.size(archive) < 1_000_000) {
                download(distributionUrl, archive);
            }
            unzipSafely(archive, cacheBase);
            makeBinExecutable(distributionHome.resolve("bin"));
        }
        if (!Files.isRegularFile(gradleScript)) {
            throw new IOException("Gradle non trovato dopo l'estrazione: " + gradleScript);
        }

        List<String> command = new ArrayList<>();
        if (isWindows()) {
            command.add("cmd.exe");
            command.add("/c");
            command.add(gradleScript.toString());
        } else {
            command.add(gradleScript.toString());
        }
        for (String arg : args) command.add(arg);
        Process process = new ProcessBuilder(command).directory(projectRoot.toFile()).inheritIO().start();
        int result = process.waitFor();
        System.exit(result);
    }

    private static Path findProjectRoot() throws IOException {
        String wrapperHome = System.getProperty("missionireflex.wrapperHome");
        Path current = wrapperHome == null || wrapperHome.isBlank()
                ? Paths.get(System.getProperty("user.dir")).toAbsolutePath().normalize()
                : Paths.get(wrapperHome).toAbsolutePath().normalize();
        for (Path p = current; p != null; p = p.getParent()) {
            if (Files.isRegularFile(p.resolve("gradle/wrapper/gradle-wrapper.properties"))) return p;
        }
        throw new IOException("Impossibile trovare gradle/wrapper/gradle-wrapper.properties. Avvia gradlew dalla cartella del progetto.");
    }

    private static boolean isWindows() {
        return System.getProperty("os.name", "").toLowerCase().contains("win");
    }

    private static void download(String value, Path destination) throws IOException {
        System.out.println("Gradle non è ancora installato. Download della distribuzione " + value);
        Path partial = destination.resolveSibling(destination.getFileName() + ".part");
        URL url = new URL(value);
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        connection.setConnectTimeout(20_000);
        connection.setReadTimeout(60_000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "MissioniReflex-GradleBootstrap/1.0");
        try {
            int response = connection.getResponseCode();
            if (response < 200 || response >= 300) throw new IOException("Download Gradle fallito: HTTP " + response);
            try (InputStream in = new BufferedInputStream(connection.getInputStream());
                 BufferedOutputStream out = new BufferedOutputStream(Files.newOutputStream(partial))) {
                byte[] buffer = new byte[64 * 1024];
                long total = 0;
                int read;
                while ((read = in.read(buffer)) != -1) {
                    out.write(buffer, 0, read);
                    total += read;
                    if (total % (16L * 1024 * 1024) < buffer.length) {
                        System.out.println("  scaricati " + (total / (1024 * 1024)) + " MB");
                    }
                }
            }
            Files.move(partial, destination, StandardCopyOption.REPLACE_EXISTING);
        } finally {
            connection.disconnect();
            Files.deleteIfExists(partial);
        }
    }

    private static void unzipSafely(Path archive, Path destination) throws IOException {
        System.out.println("Estrazione distribuzione Gradle...");
        try (ZipInputStream zip = new ZipInputStream(new BufferedInputStream(Files.newInputStream(archive)))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                Path output = destination.resolve(entry.getName()).normalize();
                if (!output.startsWith(destination.normalize())) throw new IOException("Percorso ZIP non valido");
                if (entry.isDirectory()) {
                    Files.createDirectories(output);
                } else {
                    Path parent = output.getParent();
                    if (parent != null) Files.createDirectories(parent);
                    Files.copy(zip, output, StandardCopyOption.REPLACE_EXISTING);
                }
                zip.closeEntry();
            }
        }
    }

    private static void makeBinExecutable(Path binDirectory) throws IOException {
        if (isWindows() || !Files.isDirectory(binDirectory)) return;
        try (var paths = Files.walk(binDirectory)) {
            paths.filter(Files::isRegularFile).forEach(path -> path.toFile().setExecutable(true, false));
        }
    }
}
