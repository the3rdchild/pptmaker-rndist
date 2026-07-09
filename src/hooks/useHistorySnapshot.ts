import { debounce, throttle} from 'lodash'
import { useSnapshotStore } from '@/store'

export default () => {
  const snapshotStore = useSnapshotStore()

  // Add a history snapshot (history record)
  const addHistorySnapshot = debounce(function() {
    snapshotStore.addSnapshot()
  }, 300, { trailing: true })

  // Redo
  const redo = throttle(function() {
    snapshotStore.reDo()
  }, 100, { leading: true, trailing: false })

  // Undo
  const undo = throttle(function() {
    snapshotStore.unDo()
  }, 100, { leading: true, trailing: false })

  return {
    addHistorySnapshot,
    redo,
    undo,
  }
}