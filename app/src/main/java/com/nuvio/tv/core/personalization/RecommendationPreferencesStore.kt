
package com.nuvio.tv.core.personalization

import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import com.nuvio.tv.data.local.ProfileDataStoreFactory
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Stores genre preferences separately for each Nuvio profile.
 */
@Singleton
class RecommendationPreferencesStore @Inject constructor(
    private val factory: ProfileDataStoreFactory
) {
    private val featureName = "personalized_recommendations"

    private val genresKey = stringPreferencesKey("preferred_genres")

    fun observePreferredGenres(
        profileId: Int
    ): Flow<Map<String, Int>> {
        require(profileId > 0)

        return factory.get(profileId, featureName)
            .data
            .map { preferences ->
                decodeGenres(preferences[genresKey].orEmpty())
            }
    }

    suspend fun savePreferredGenres(
        profileId: Int,
        genres: Map<String, Int>
    ) {
        require(profileId > 0)

        val encoded = genres
            .filter { (genre, weight) ->
                genre.isNotBlank() && weight > 0
            }
            .mapKeys { (genre, _) ->
                genre.trim().lowercase()
            }
            .entries
            .joinToString("\n") { (genre, weight) ->
                "$genre=$weight"
            }

        factory.get(profileId, featureName).edit {
            it[genresKey] = encoded
        }
    }

    private fun decodeGenres(
        encoded: String
    ): Map<String, Int> {
        return encoded.lineSequence()
            .mapNotNull { line ->
                val separator = line.lastIndexOf('=')
                if (separator <= 0) return@mapNotNull null

                val genre = line.substring(0, separator)
                    .trim()
                    .lowercase()

                val weight = line.substring(separator + 1)
                    .toIntOrNull()

                if (genre.isBlank() || weight == null || weight <= 0) {
                    null
                } else {
                    genre to weight
                }
            }
            .toMap()
    }
}
