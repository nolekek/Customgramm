import java.io.File
import org.apache.tools.ant.taskdefs.condition.Os
import org.gradle.api.DefaultTask
import org.gradle.api.GradleException
import org.gradle.api.logging.LogLevel
import org.gradle.api.tasks.Input
import org.gradle.api.tasks.TaskAction
import javax.inject.Inject
import org.gradle.process.ExecOperations

abstract class BuildTask : DefaultTask() {
    @get:Inject
    abstract val execOperations: ExecOperations

    @Input
    var rootDirRel: String? = null
    @Input
    var projectDir: String? = null
    @Input
    var target: String? = null
    @Input
    var release: Boolean? = null

    @TaskAction
    fun assemble() {
        val rootDirRel = rootDirRel ?: "."
        val targetName = target ?: "aarch64"
        val rustTarget = when (targetName) {
            "aarch64" -> "aarch64-linux-android"
            "armv7" -> "armv7-linux-androideabi"
            "i686" -> "i686-linux-android"
            "x86_64" -> "x86_64-linux-android"
            else -> targetName
        }
        val abi = when (targetName) {
            "aarch64" -> "arm64-v8a"
            "armv7" -> "armeabi-v7a"
            "i686" -> "x86"
            "x86_64" -> "x86_64"
            else -> targetName
        }
        val mode = if (release == true) "release" else "debug"
        val rootDir = File(projectDir, rootDirRel)
        val candidateSo = File(rootDir, "target/$rustTarget/$mode/libapp_lib.so")
        val destDir = File(projectDir, "src/main/jniLibs/$abi")
        val destSo = File(destDir, "libapp_lib.so")

        if (destSo.exists() && destSo.length() > 0) {
            println("Using existing native lib at: ${destSo.absolutePath}")
            return
        }

        if (candidateSo.exists() && candidateSo.length() > 0) {
            destDir.mkdirs()
            candidateSo.copyTo(destSo, overwrite = true)
            println("Copied $candidateSo to $destSo")
            return
        }

        val executable = """npm""";
        try {
            runTauriCli(executable)
        } catch (e: Exception) {
            if (candidateSo.exists() && candidateSo.length() > 0) {
                destDir.mkdirs()
                candidateSo.copyTo(destSo, overwrite = true)
                println("Copied after CLI error: $candidateSo to $destSo")
                return
            }
            if (Os.isFamily(Os.FAMILY_WINDOWS)) {
                // Try different Windows-specific extensions
                val fallbacks = listOf(
                    "$executable.exe",
                    "$executable.cmd",
                    "$executable.bat",
                )

                var lastException: Exception = e
                for (fallback in fallbacks) {
                    try {
                        runTauriCli(fallback)
                        return
                    } catch (fallbackException: Exception) {
                        if (candidateSo.exists() && candidateSo.length() > 0) {
                            destDir.mkdirs()
                            candidateSo.copyTo(destSo, overwrite = true)
                            println("Copied after fallback error: $candidateSo to $destSo")
                            return
                        }
                        lastException = fallbackException
                    }
                }
                throw lastException
            } else {
                throw e;
            }
        }
    }

    fun runTauriCli(executable: String) {
        val rootDirRel = rootDirRel ?: throw GradleException("rootDirRel cannot be null")
        val target = target ?: throw GradleException("target cannot be null")
        val release = release ?: throw GradleException("release cannot be null")
        val args = listOf("run", "--", "tauri", "android", "android-studio-script");

        execOperations.exec {
            workingDir(File(projectDir, rootDirRel))
            executable(executable)
            args(args)
            if (logger.isEnabled(LogLevel.DEBUG)) {
                args("-vv")
            } else if (logger.isEnabled(LogLevel.INFO)) {
                args("-v")
            }
            if (release) {
                args("--release")
            }
            args(listOf("--target", target))
        }.assertNormalExitValue()
    }
}