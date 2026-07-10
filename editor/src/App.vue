<template>
  <template v-if="slides.length">
    <Screen v-if="screening" />
    <Editor v-else-if="_isPC" />
    <Mobile v-else />
  </template>
  <FullscreenSpin tip="Initializing data, please wait ..." v-else  loading :mask="false" />
</template>

<script lang="ts" setup>
import { onMounted, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { nanoid } from 'nanoid'
import { useScreenStore, useMainStore, useSnapshotStore, useSlidesStore } from '@/store'
import { LOCALSTORAGE_KEY_DISCARDED_DB } from '@/configs/storage'
import { deleteDiscardedDB } from '@/utils/database'
import { isPC } from '@/utils/common'
import api from '@/services'

import Editor from './views/Editor/index.vue'
import Screen from './views/Screen/index.vue'
import Mobile from './views/Mobile/index.vue'
import FullscreenSpin from '@/components/FullscreenSpin.vue'

const _isPC = isPC()

const mainStore = useMainStore()
const slidesStore = useSlidesStore()
const snapshotStore = useSnapshotStore()
const screenStore = useScreenStore()
const { databaseId } = storeToRefs(mainStore)
const { slides } = storeToRefs(slidesStore)
const { screening } = storeToRefs(screenStore)

const isAudienceMode = new URLSearchParams(window.location.search).get('mode') === 'audience'

if (import.meta.env.MODE !== 'development') {
  window.onbeforeunload = () => false
}

onMounted(async () => {
  if (isAudienceMode) {
    slidesStore.setSlides([{
      id: nanoid(10),
      elements: [],
    }])
    screenStore.setScreening(true)
  }
  else {
    // Load deck from our backend if deckId is in URL params (embedded mode)
    const deckId = new URLSearchParams(window.location.search).get('deckId')
    const token = new URLSearchParams(window.location.search).get('token')

    if (token) {
      localStorage.setItem('ppt_session_token', token)
    }

    if (deckId) {
      try {
        const res = await fetch(`/api/v1/decks/${deckId}`, {
          headers: { 'x-session-token': token || localStorage.getItem('ppt_session_token') || '' },
        })
        const body = await res.json()
        const deck = body.data
        if (deck?.payload?.slides?.length) {
          slidesStore.setSlides(deck.payload.slides, deck.payload.theme)
          if (deck.title) slidesStore.setTitle(deck.title)
          if (deck.payload.width) slidesStore.setViewportSize(deck.payload.width)
          if (deck.payload.height && deck.payload.width) {
            slidesStore.setViewportRatio(deck.payload.height / deck.payload.width)
          }
        }
        else {
          // Empty deck (no slides yet) — seed one blank slide
          slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
        }
      }
      catch (err) {
        console.error('Failed to load deck:', err)
        slidesStore.setSlides([{ id: nanoid(10), elements: [] }])
      }
    }
    else {
      // No deckId — load default mock data (standalone mode)
      const slides = await api.getMockData('slides')
      slidesStore.setSlides(slides)
    }

    await deleteDiscardedDB()
    snapshotStore.initSnapshotDatabase()

    // Setup auto-save: watch slides changes, postMessage to parent iframe
    setupAutoSave()

    // Auto-open AI dialog if a prompt was passed via URL params from dashboard
    const urlParams = new URLSearchParams(window.location.search)
    const aiPrompt = urlParams.get('prompt')
    if (aiPrompt) {
      setTimeout(() => {
        mainStore.setAIPPTDialogState(true)
      }, 1000)
    }
  }
})

// Auto-save: post deck state to parent window (Next.js iframe host)
function setupAutoSave() {
  const { slides, theme, title, viewportSize, viewportRatio } = storeToRefs(slidesStore)
  let saveTimer: ReturnType<typeof setTimeout> | null = null

  const sendToParent = () => {
    if (window.parent === window) return // not in iframe
    const deckPayload = {
      title: title.value,
      width: viewportSize.value,
      height: viewportSize.value * viewportRatio.value,
      viewportSize: viewportSize.value,
      viewportRatio: viewportRatio.value,
      theme: theme.value,
      slides: slides.value,
    }
    // Post only to the expected parent origin (localhost:3000 in dev)
    const parentOrigin = import.meta.env.MODE === 'development'
      ? 'http://localhost:3000'
      : window.location.origin
    window.parent.postMessage({
      type: 'deck-changed',
      deck: deckPayload,
    }, parentOrigin)
  }

  // Debounced save on slides/theme/title change
  watch([slides, theme, title], () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(sendToParent, 1500)
  }, { deep: true })
}

// When the app is unloaded, record this indexedDB database ID in localStorage for later database cleanup
window.addEventListener('beforeunload', () => {
  const discardedDB = localStorage.getItem(LOCALSTORAGE_KEY_DISCARDED_DB)
  const discardedDBList: string[] = discardedDB ? JSON.parse(discardedDB) : []

  discardedDBList.push(databaseId.value)

  const newDiscardedDB = JSON.stringify(discardedDBList)
  localStorage.setItem(LOCALSTORAGE_KEY_DISCARDED_DB, newDiscardedDB)
})
</script>

<style lang="scss">
#app {
  height: 100%;
}
</style>