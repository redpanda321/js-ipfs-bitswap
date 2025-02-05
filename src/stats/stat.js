import { EventEmitter } from 'events'
import MovingAverage from '@vascosantos/moving-average'

/**
 * @typedef {import('@vascosantos/moving-average').IMovingAverage} IMovingAverage
 * @typedef {[string, number, number]} Op
 */

export class Stat extends EventEmitter {
  /**
   *
   * @param {string[]} initialCounters
   * @param {object} options
   * @param {boolean} options.enabled
   * @param {number} options.computeThrottleTimeout
   * @param {number} options.computeThrottleMaxQueueSize
   * @param {import('.').AverageIntervals} options.movingAverageIntervals
   */
  constructor (initialCounters, options) {
    super()

    this._options = options
    /** @type {Op[]} */
    this._queue = []
    /** @type {Record<string, bigint>} */
    this._stats = {}

    this._frequencyLastTime = Date.now()
    /** @type {Record<string, number>} */
    this._frequencyAccumulators = {}

    /** @type {Record<string, Record<number, IMovingAverage>>} */
    this._movingAverages = {}

    this._update = this._update.bind(this)

    initialCounters.forEach((key) => {
      this._stats[key] = BigInt(0)
      this._movingAverages[key] = {}
      this._options.movingAverageIntervals.forEach((interval) => {
        const ma = this._movingAverages[key][interval] = MovingAverage(interval)
        ma.push(this._frequencyLastTime, 0)
      })
    })

    this._enabled = this._options.enabled
  }

  enable () {
    this._enabled = true
  }

  disable () {
    this._disabled = true
  }

  stop () {
    if (this._timeout) {
      clearTimeout(this._timeout)
    }
  }

  get snapshot () {
    return Object.assign({}, this._stats)
  }

  get movingAverages () {
    return Object.assign({}, this._movingAverages)
  }

  /**
   * @param {string} counter
   * @param {number} inc
   */
  push (counter, inc) {
    if (this._enabled) {
      this._queue.push([counter, inc, Date.now()])
      this._resetComputeTimeout()
    }
  }

  /**
   * @private
   */
  _resetComputeTimeout () {
    if (this._timeout) {
      clearTimeout(this._timeout)
    }
    this._timeout = setTimeout(this._update, this._nextTimeout())
  }

  /**
   * @private
   * @returns {number}
   */
  _nextTimeout () {
    // calculate the need for an update, depending on the queue length
    const urgency = this._queue.length / this._options.computeThrottleMaxQueueSize
    return Math.max(this._options.computeThrottleTimeout * (1 - urgency), 0)
  }

  /**
   * @private
   */
  _update () {
    this._timeout = null

    if (this._queue.length) {
      let last
      while (this._queue.length) {
        const op = last = this._queue.shift()
        op && this._applyOp(op)
      }

      last && this._updateFrequency(last[2]) // contains timestamp of last op

      this.emit('update', this._stats)
    }
  }

  /**
   * @private
   * @param {number} latestTime
   */
  _updateFrequency (latestTime) {
    const timeDiff = latestTime - this._frequencyLastTime

    if (timeDiff) {
      Object.keys(this._stats).forEach((key) => {
        this._updateFrequencyFor(key, timeDiff, latestTime)
      })
    }

    this._frequencyLastTime = latestTime
  }

  /**
   * @private
   * @param {string} key
   * @param {number} timeDiffMS
   * @param {number} latestTime
   * @returns {void}
   */
  _updateFrequencyFor (key, timeDiffMS, latestTime) {
    const count = this._frequencyAccumulators[key] || 0
    this._frequencyAccumulators[key] = 0
    const hz = (count / timeDiffMS) * 1000

    let movingAverages = this._movingAverages[key]
    if (!movingAverages) {
      movingAverages = this._movingAverages[key] = {}
    }
    this._options.movingAverageIntervals.forEach((movingAverageInterval) => {
      let movingAverage = movingAverages[movingAverageInterval]
      if (!movingAverage) {
        movingAverage = movingAverages[movingAverageInterval] = MovingAverage(movingAverageInterval)
      }
      movingAverage.push(latestTime, hz)
    })
  }

  /**
   * @private
   * @param {Op} op
   */
  _applyOp (op) {
    const key = op[0]
    const inc = op[1]

    if (typeof inc !== 'number') {
      throw new Error(`invalid increment number: ${inc}`)
    }

    if (!Object.prototype.hasOwnProperty.call(this._stats, key)) {
      this._stats[key] = BigInt(0)
    }

    this._stats[key] = BigInt(this._stats[key]) + BigInt(inc)

    if (!this._frequencyAccumulators[key]) {
      this._frequencyAccumulators[key] = 0
    }
    this._frequencyAccumulators[key] += inc
  }
}
