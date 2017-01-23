const _ = require('lodash')

let recipe = require('./data/sample.json')

function gather_vars(recipe) {
    let out = {}
    _.each(recipe,(v,k) => {
        if (k[0] != "@") {
            if (_.isArray(v)) {
                if (_.isObject(v[v.length-1])) {
                    out[k] = ['range', v.slice(0,v.length-1), v[v.length-1]]
                } else {
                    out[k] = ['range', v]
                }                
            } else if (_.isNumber(v)) {
                out[k] = ['const', v]
            } else if (_.isObject(v)) {
                let sub = gather_vars(v)
                if (_.keys(sub).length) {
                    out[k] = sub
                }                
            } 
        }
    })
    return out
}

function pack_vars(x,prefix = '') {
    let out = {}
    _.each(x,(v,k) => {
        if (_.isArray(v)) {
            out[prefix + k] = v
        } else {
            _.extend(out,pack_vars(v,`${prefix}${k}.`))
        }
    })
    return out
}

function unpack_vars(x, prefix = '') {
    let out = {}
    _.each(x,(v,k) => {
        if (k.substr(0,prefix.length) != prefix) return
        k = k.substr(prefix.length)

        let index = k.indexOf('.')
        if (index<0) {
            out[k] = v
        } else {
            let kk = k.substr(0,index)
            out[kk] = _.extend(out[kk] || {}, unpack_vars(x,prefix+kk+'.'))
        }
    })
    return out
}

function sample_vars(packed,session) {
    let out = {}
    let fn = {
        const: arg => arg,
        range: (arg,opt) => {
            if (opt && opt.cont) {
                if (opt.cont == 'log') {
                    return Math.exp(Math.random() * Math.log(arg[1] - arg[0])) + arg[0]
                } else {
                    return Math.random() * (arg[1] - arg[0]) + arg[0]
                }                
            } else {
                return _.shuffle(arg)[0]
            }
        }
    }
    _.each(packed,(v,k) => {
        let [type,arg,opt] = v
        out[k] = fn[type](arg,opt)
    })
    return out
}

function fetch_session(recipe) {
    return Promise.resolve({})
}

function sample(recipe) {
    return fetch_session(recipe)
        .then(session => unpack_vars(sample_vars(pack_vars(gather_vars(recipe)),session)))
}

function locate(data,vars) {
    if (data["@origin"] == undefined) throw new Error("Unable to locate non-data")
    return launch_with_vars(data,vars)
}

function launch_with_vars(recipe,vars) {
    let pre = []
    _.each(recipe,(v,k) => {
        if (v["@origin"]) {
            pre.push(locate(v,vars[k]))
        }
    })
    return Promise.all(pre).then(() => {
        console.log(`Launching ${JSON.stringify(recipe)}`)
    })
}

function launch(recipe) {
    return sample(recipe).then(vars => launch_with_vars(recipe,vars))
}

class Docker {
    constructor(host) {
        this.host = host
    }

    exec(args) {
        console.log(`docker -H=tcp://${this.host}:2375 ${args}`)
        return Promise.resolve()
    }
}

class Container {
    constructor(recipe,id) {
        [this.instance,this.node] = id.split('@')
        this.recipe = recipe
        this.docker = new Docker(this.node)
    }
}

function volumes_from_recipe(recipe) {
    let volumes = []
    _.each(recipe,(v,k) => {
        if (_.isObject(v) && v["@origin"]) {
            volumes.push(k)
        }
    })
    return volumes
}

class Instance extends Container {
    constructor(recipe,id) {
        super(recipe,id)
    }

    run() {
        let volumes = volumes_from_recipe(recipe)
        volumes = volumes.map(v => `--volumes-from ${v}`).join(' ')
        return this.docker.exec(`run --name ${this.instance} ${volumes}`)
    }

    freeze() {
        return this.docker.exec(`stop ${this.instance} --time=30`)
    }

    thaw() {
        return this.docker.exec(`restart ${this.instance}`)
    }
}

function search(recipe) {
    return Promise.resolve([new Instance(recipe,'instance@node')])
}

launch(recipe)
new Instance(recipe,"test@your-node").run()
search(recipe).then(instances => {
    instances.forEach(x => {
        x.freeze().then(_ => x.thaw())
    })
})
