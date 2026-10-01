package com.albion.market.litert

import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.security.MessageDigest

class ModelArtifactVerifierTest {
    private fun tempDir(): File = Files.createTempDirectory("model-artifact-test").toFile()
    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256")
        .digest(bytes).joinToString("") { "%02x".format(it) }

    @Test
    fun promotesOnlyAnExactlySizedMatchingArtifact() {
        val dir = tempDir()
        val partial = File(dir, "model.litertlm.tmp").apply { writeBytes("verified-model".toByteArray()) }
        val final = File(dir, "model.litertlm")
        val backup = File(dir, "model.litertlm.backup")
        val expected = partial.readBytes()

        val promotedSize = ModelArtifactVerifier.verifyAndPromote(
            partial,
            final,
            backup,
            expected.size.toLong(),
            sha256(expected),
            promote = { source, destination ->
                assertTrue(source.renameTo(destination))
            },
            syncDirectory = {},
        )

        assertEquals(expected.size.toLong(), promotedSize)
        assertArrayEquals(expected, final.readBytes())
        assertFalse(partial.exists())
        assertTrue(ModelArtifactVerifier.isVerified(final, expected.size.toLong(), sha256(expected)))
        dir.deleteRecursively()
    }

    @Test
    fun sizeMismatchDeletesPartialAndPreservesExistingFinal() {
        val dir = tempDir()
        val partial = File(dir, "model.litertlm.tmp").apply { writeText("short") }
        val final = File(dir, "model.litertlm").apply { writeText("known-good") }

        assertThrows(IllegalStateException::class.java) {
            ModelArtifactVerifier.verifyAndPromote(partial, final, File(dir, "backup"), 100L, "0".repeat(64))
        }

        assertFalse(partial.exists())
        assertEquals("known-good", final.readText())
        dir.deleteRecursively()
    }

    @Test
    fun hashMismatchDeletesPartialAndPreservesExistingFinal() {
        val dir = tempDir()
        val partial = File(dir, "model.litertlm.tmp").apply { writeText("wrong") }
        val final = File(dir, "model.litertlm").apply { writeText("known-good") }

        assertThrows(IllegalStateException::class.java) {
            ModelArtifactVerifier.verifyAndPromote(partial, final, File(dir, "backup"), partial.length(), "0".repeat(64))
        }

        assertFalse(partial.exists())
        assertEquals("known-good", final.readText())
        dir.deleteRecursively()
    }

    @Test
    fun readinessRejectsWrongSizeEvenWhenFileExists() {
        val dir = tempDir()
        val final = File(dir, "model.litertlm").apply { writeText("truncated") }
        assertFalse(ModelArtifactVerifier.isVerified(final, final.length() + 1, sha256(final.readBytes())))
        dir.deleteRecursively()
    }

    @Test
    fun retainsKnownGoodBackupUntilCallerCommitsPromotion() {
        val dir = tempDir()
        val partial = File(dir, "model.tmp").apply { writeText("replacement") }
        val final = File(dir, "model.litertlm").apply { writeText("known-good") }
        val backup = File(dir, "model.backup")
        val expected = partial.readBytes()

        ModelArtifactVerifier.verifyAndPromote(
            partial, final, backup, expected.size.toLong(), sha256(expected),
            promote = { source, destination -> assertTrue(source.renameTo(destination)) },
            syncDirectory = {},
        )

        assertEquals("replacement", final.readText())
        assertEquals("known-good", backup.readText())
        dir.deleteRecursively()
    }

    @Test
    fun failedReplacementRestoresKnownGoodFinal() {
        val dir = tempDir()
        val partial = File(dir, "model.tmp").apply { writeText("replacement") }
        val final = File(dir, "model.litertlm").apply { writeText("known-good") }
        val backup = File(dir, "model.backup")
        val expected = partial.readBytes()
        var renames = 0

        assertThrows(IllegalStateException::class.java) {
            ModelArtifactVerifier.verifyAndPromote(
                partial, final, backup, expected.size.toLong(), sha256(expected),
                promote = { source, destination ->
                    renames += 1
                    if (renames == 2) error("simulated promotion failure")
                    assertTrue(source.renameTo(destination))
                },
                syncDirectory = {},
            )
        }

        assertEquals("known-good", final.readText())
        assertFalse(backup.exists())
        dir.deleteRecursively()
    }

    @Test
    fun readinessRejectsMissingHashMetadata() {
        val dir = tempDir()
        val final = File(dir, "model.litertlm").apply { writeText("complete-size") }

        assertFalse(ModelArtifactVerifier.isVerified(final, final.length(), ""))
        dir.deleteRecursively()
    }

    @Test
    fun importsUntrustedDownloadIntoPrivateDirectoryBeforePromotion() {
        val staging = tempDir()
        val privateDir = tempDir()
        val downloaded = File(staging, "model.tmp").apply { writeText("verified-private-model") }
        val privatePartial = File(privateDir, "model.tmp")
        val final = File(privateDir, "model.litertlm")
        val backup = File(privateDir, "model.backup")
        val expected = downloaded.readBytes()

        val size = ModelArtifactVerifier.importAndPromote(
            downloaded, privatePartial, final, backup,
            expected.size.toLong(), sha256(expected),
            promote = { source, destination -> assertTrue(source.renameTo(destination)) },
            syncDirectory = {},
        )

        assertEquals(expected.size.toLong(), size)
        assertArrayEquals(expected, final.readBytes())
        assertFalse(downloaded.exists())
        assertFalse(privatePartial.exists())
        staging.deleteRecursively()
        privateDir.deleteRecursively()
    }

    @Test
    fun preservesLegacySourceWhenMigrationPromotionFails() {
        val staging = tempDir()
        val privateDir = tempDir()
        val downloaded = File(staging, "model.litertlm").apply { writeText("verified-legacy-model") }
        val privatePartial = File(privateDir, "model.tmp")
        val final = File(privateDir, "model.litertlm")
        val backup = File(privateDir, "model.backup")
        val expected = downloaded.readBytes()

        assertThrows(IllegalStateException::class.java) {
            ModelArtifactVerifier.importAndPromote(
                downloaded, privatePartial, final, backup,
                expected.size.toLong(), sha256(expected),
                deleteSourceOnFailure = false,
                promote = { _, _ -> error("simulated promotion failure") },
                syncDirectory = {},
            )
        }

        assertTrue(downloaded.exists())
        assertFalse(privatePartial.exists())
        staging.deleteRecursively()
        privateDir.deleteRecursively()
    }

    @Test
    fun rejectsOversizedSourceBeforeCreatingPrivatePartial() {
        val staging = tempDir()
        val privateDir = tempDir()
        val downloaded = File(staging, "model.litertlm").apply { writeBytes(ByteArray(32) { 7 }) }
        val privatePartial = File(privateDir, "model.tmp")
        val final = File(privateDir, "model.litertlm")
        val backup = File(privateDir, "model.backup")

        assertThrows(IllegalStateException::class.java) {
            ModelArtifactVerifier.importAndPromote(
                downloaded, privatePartial, final, backup,
                16L, sha256(ByteArray(16) { 7 }),
                deleteSourceOnFailure = false,
                syncDirectory = {},
            )
        }

        assertTrue(downloaded.exists())
        assertFalse(privatePartial.exists())
        assertFalse(final.exists())
        staging.deleteRecursively()
        privateDir.deleteRecursively()
    }
}
