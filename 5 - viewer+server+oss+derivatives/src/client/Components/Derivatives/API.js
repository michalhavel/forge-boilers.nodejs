import JobPanel from './JobPanel/JobPanel.js'
import ClientAPI from 'ClientAPI'
import _ from 'lodash'

export default class DerivativesAPI extends ClientAPI {

  constructor (opts) {

    super(opts.apiUrl)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  postJob (payload) {

    const url = `${this.apiUrl}/job`

    const data = {
      payload: JSON.stringify(payload)
    }

    return this.ajax({
      type: 'POST',
      data,
      url
    })
  }

  /////////////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////////////
  buildDefaultJobQuery (job) {

    switch (job.output.formats[0].type) {

      case 'obj':

        const objIds = job.output.formats[0].advanced.objectIds

        if (objIds) {

          return (derivative) => {
            return (
              derivative.role === 'obj' &&
              _.isEqual(derivative.objectIds, objIds)
            )
          }
        }

      default:

        return { role: job.output.formats[0].type }
    }
  }

  /////////////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////////////
  postJobWithProgress (job, opts, query = null) {

    return new Promise(async(resolve, reject) => {

      var jobPanel = new JobPanel(
        opts.panelContainer,
        opts.designName,
        job.output.formats[0].type)

      jobPanel.setVisible(true)

      try {

        console.log('Posting Job:')
        console.log(job)

        var jobRes = await this.postJob(job)

        if (jobRes.result === 'success' || jobRes.result === 'created') {

          const onProgress = (progress) => {

            jobPanel.updateProgress(progress)
          }

          const derivative = await this.getDerivative (
            job.input.urn,
            query || this.buildDefaultJobQuery(job),
            job.output.formats[0].type,
            onProgress, true)

          jobPanel.done()

          resolve(derivative)

        } else {

          jobPanel.jobFailed(job)

          return reject(job)
        }

      } catch(ex) {

        jobPanel.jobFailed(ex)

        return reject(ex)
      }
    })
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getFormats () {

    const url = `${this.apiUrl}/formats`

    return this.ajax(url)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getMetadata (urn) {

    const url = `${this.apiUrl}/metadata/${urn}`

    return this.ajax(url)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getManifest (urn) {

    const url = `${this.apiUrl}/manifest/${urn}`

    return this.ajax(url)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getProperties (urn, guid) {

    const url = `${this.apiUrl}/properties/${urn}/${guid}`

    return this.ajax(url)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getHierarchy (urn, guid) {

    const url = `${this.apiUrl}/hierarchy/${urn}/${guid}`

    return this.ajax(url)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getThumbnail(urn, options = { width:100, height:100 }) {

    const query = `width=${options.width}&height=${options.height}`

    const url = `${this.apiUrl}/thumbnails/${urn}?${query}`

    return this.ajax(url)
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  deleteManifest (urn) {

    const url = `${this.apiUrl}/manifest/${urn}`

    return this.ajax({
      type: 'DELETE',
      url
    })
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  findDerivatives (parent, query) {

    const derivatives = parent.derivatives || parent.children

    if (derivatives) {

      const matches = derivatives.filter((derivative) => {

        derivative.parent = parent

        if (typeof query === 'object') {

          var match = true

          for (const key in query) {

            if (query[key] !== derivative[key]) {

              match = false
            }
          }

          return match

        } else if (typeof query === 'function') {

          return query (derivative)
        }
      })

      const childResults = derivatives.map((derivative) => {

        return this.findDerivatives (
          derivative, query)
      })

      return _.flattenDeep([...matches, ...childResults])
    }

    return []
  }

  /////////////////////////////////////////////////////////////////
  //
  //
  /////////////////////////////////////////////////////////////////
  hasDerivative (manifest, query) {

    var derivatives = this.findDerivatives(
      manifest, query)

    return derivatives.length > 0
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getDerivative (urn, query, outputType,
                 onProgress = null,
                 skipNotFound = false) {

    return new Promise(async(resolve, reject) => {

      try {

        while (true) {

          var manifest = await this.getManifest(urn)

          //if(manifest.status === 'failed') {
          //  return reject(manifest)
          //}

          if(!manifest.derivatives) {

            return reject(manifest)
          }

          var derivatives = this.findDerivatives(
            manifest, query)

          if (derivatives.length) {

            const derivative = derivatives[0]

            let progress = manifest.progress.split(' ')[0]

            progress = (progress === 'complete' ? '100%' : progress)

            onProgress ? onProgress(progress) : ''

            const status =
              derivative.status ||
              derivative.parent.status

            if (status === 'success') {

              onProgress ? onProgress('100%') : ''

              return resolve(derivative)

            } else if (status === 'failed') {

              onProgress ? onProgress('failed') : ''

              return reject(derivative)
            }
          }

          // if no parent -> no derivative of this type
          // OR
          // if parent complete and no target -> derivative not requested

          const parentDerivatives = this.findDerivatives(
            manifest, { outputType })

          if (!parentDerivatives.length) {

            if (manifest.status === 'inprogress') {

              const progress = manifest.progress.split(' ')[0]

              onProgress ? onProgress(progress) : ''
            }

            if(!skipNotFound) {

              return resolve({
                status: 'not found'
              })
            }

          } else if(parentDerivatives[0].status === 'success') {

            if(!derivatives.length) {

              onProgress ? onProgress('0%') : ''

              if(!skipNotFound) {

                return resolve({
                  status: 'not found'
                })
              }
            }
          }

          await sleep(1000)
        }

      } catch(ex) {

        return reject(ex)
      }
    })
  }

  ///////////////////////////////////////////////////////////////////
  //
  //
  ///////////////////////////////////////////////////////////////////
  getDownloadURI (urn, derivativeUrn, filename) {

    return `${this.apiUrl}/download?` +
      `urn=${urn}&` +
      `derivativeUrn=${encodeURIComponent(derivativeUrn)}&` +
      `filename=${encodeURIComponent(filename)}`
  }

  /////////////////////////////////////////////////////////////////
  // Download util
  //
  /////////////////////////////////////////////////////////////////
  downloadURI (uri, name) {

    var link = document.createElement("a")
    link.download = name
    link.href = uri
    link.click()
  }
}

///////////////////////////////////////////////////////////////
//
//
///////////////////////////////////////////////////////////////
function sleep (ms) {
  return new Promise((resolve)=> {
      setTimeout( ()=>{
        resolve()
      }, ms)
  })
}
