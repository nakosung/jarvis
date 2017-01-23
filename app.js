let recipe = {
    "github.com/nakosung/trainer": {
        "data" : {
            "github.com/nakosung/processor": {
                // 하나면 constant
                "args": ["--datadir /data --outdir $out"],
                "data": {
                    "github.com/nakosung/data-source": {
                        "args": "--outdir $out"
                    }
                },
                normalize: [true,false]                
            }
        },
        "iter": 3000,
        // array는 enumerate
        "dropout": [true,false],
        // 추가 정보는 마지막에
        "learning-rate": [0.2,0.5,{cont:'log'}]
    }
}

function launch(recipe) {
    console.log('launch')
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

class Instance extends Container {
    constructor(recipe,id) {
        super(recipe,id)
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
search(recipe).then(instances => {
    instances.forEach(x => {
        x.freeze().then(_ => x.thaw())
    })
})

