class RayCastingShader {
    constructor(volume, frontFBO, backFBO) {

        const volumeTexture = new THREE.DataTexture3D( volume.voxels, volume.width, volume.height, volume.depth );
        volumeTexture.format =  THREE.RedFormat; // THREE.RGBAFormat; //
        volumeTexture.type = THREE.FloatType; // THREE.UnsignedShort4444Type;
        volumeTexture.minFilter = volumeTexture.magFilter = THREE.LinearFilter;
        volumeTexture.unpackAlignment = 1;
        //this.texture.side = THREE.DoubleSide;

        volumeTexture.needsUpdate = true;

        console.log(volumeTexture);
        this.material = new THREE.ShaderMaterial
        ({
            uniforms: {
                volume: { value: volumeTexture },
                frontCube: { value: frontFBO.renderTarget.texture },
                backCube: { value: backFBO.renderTarget.texture },
                iso: { value: 0.01 }
            },
            vertexShader: this.vertexShader(),
            fragmentShader: this.fragmentShader(),
            transparent: true
        });


        //this.material.uniforms['volume'].value = volumeTexture;

        // console.log(volumeTexture);
        // volumeTexture.image.data.forEach(function (v, i){
        //     if(v > 0){
        //         console.log(i + ": " + v);
        //     }
        // });
    }

    setIso(iso){
        this.material.uniforms['iso'].value = iso;
    }

    vertexShader(){
        return `
        varying vec3 vPosition; 
        varying vec2 texCoord; 
        
        void main() {
            vPosition = position; 
            texCoord = vec2(position.x, position.y) * 0.5 + 0.5; 
            //vec4 mvPosition = modelViewMatrix * vec4( position, 1.0);
            //gl_Position = projectionMatrix * mvPosition;
            gl_Position = vec4(position, 1); 
        }
        `;
    }

    fragmentShader(){
        return `
        precision highp sampler3D;
        
        uniform sampler3D volume; 
        uniform sampler2D frontCube;
        uniform sampler2D backCube;
        uniform float iso; 
        
        varying vec3 vPosition;
        varying vec2 texCoord; 
        
        vec3 gradient(vec3 uvw){
            vec3 s1, s2; 
            
            float DELTA = 0.008; 
            vec3 deltaU = vec3(DELTA,0.0,0.0); 
            vec3 deltaV = vec3(0.0,DELTA,0.0); 
            vec3 deltaW = vec3(0.0,0.0,DELTA);
            
            s1.x = texture(volume, uvw-deltaU).r;
            s2.x = texture(volume, uvw+deltaU).r;
            
            s1.y = texture(volume, uvw-deltaV).r;
            s2.y = texture(volume, uvw+deltaV).r;
            
            s1.z = texture(volume, uvw-deltaW).r;
            s2.z = texture(volume, uvw+deltaW).r;
            
            return s1-s2; 
        }
        
        
        vec3 Phong(vec3 viewDir, vec3 normal, vec3 color, float k_ambient, float k_diffuse, float k_specular)
        {
            float ambient  = k_ambient;
            float diffuse  = max(k_diffuse * dot(-viewDir, normal), 0.0);
            float shiny = max(dot(reflect(-viewDir, normal), viewDir), 0.0);
            float specular = k_specular * shiny * shiny * shiny;
            return (ambient + diffuse) * color + specular;
        }
        
        vec3 hsv2rgb(float h, float s, float v)
        {
            vec3 c = vec3(h, s, v);
            vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
            vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
            return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }
        
        //fixed transfer function for now
        vec4 TFfixed(float x, float density)
        {
            vec4 res; //RGB + opacity                
            
            if(density > 0.1 && density < 0.3)
            { 
              res = vec4(vec3(0.7, 0.2, 0.4), 0.2);
            }
            
            if(density > 0.3 && density < 0.5)
            {                
                res = vec4(vec3(0.1, 0.7, 0.4), 0.4);
            }
            
            if(density > 0.5 && density < 0.7)
            {                
                res = vec4(vec3(0.1, 0.6, 0.2), 0.6);
            }
                       
            
            if(density > 0.7 && density < 1.0)
            {                
                res = vec4(vec3(0.2, 0.5, 0.8), 0.7);
            }
            
            return res;
            
        }                    
        
        //
        
        void main(){
            vec3 uvw = vec3(vPosition.x, vPosition.y ,vPosition.z);
            vec3 start = texture(frontCube, texCoord).rgb; 
            vec3 end = texture(backCube, texCoord).rgb; 
            vec3 ray = end - start; 
            float rayLenSquared = dot(ray, ray);

            if (rayLenSquared < 0.000001) {
               gl_FragColor = vec4(0.0);
               return;
            }

            vec3 dir = normalize(ray); 
            vec3 step = dir * vec3(0.001);
            //float endDist = dot(end, end);
            //float startDist = dot(start, start);
            
            // render bounding cube
            //gl_FragColor = vec4(vec3(rayLenSquared * 0.5), 1.0);
            
            vec3 color = vec3(0);
            vec3 voxelColor = vec3(0.8, 0.3, 0.3);
            
            vec3 rayPosPrev = start;
            float voxelPrev = texture(volume, rayPosPrev.xyz).r;

            vec3 rayPosCurr;
            float voxelCurr;
            
            //variables for alpha compositing
            vec3 colCurr;
            vec3 colAcc = vec3(0);
            vec3 colOut;
            float alphaCurr;
            float alphaAcc = 0.0;
            float alphaOut;
            //

            
            for (int i = 0; i < 2048; i++) {

                rayPosCurr = rayPosPrev + step;
                voxelCurr = texture(volume, rayPosCurr.xyz).r;

                vec3 insideRay = rayPosCurr - start;
                if(dot(insideRay, insideRay) > rayLenSquared) break;
                
                //---alpha compositing, Front-to-Back with early ray termination
                vec4 tf = TFfixed(voxelCurr, voxelCurr);
                colCurr = tf.rgb;
                alphaCurr = tf.a;
                
                colOut = colCurr * alphaCurr * (1.0-alphaAcc) + colAcc;
                alphaOut = alphaCurr * (1.0-alphaAcc) + alphaAcc;
                               
                colAcc = colOut;
                alphaAcc = alphaOut;
                
                if(alphaAcc > 0.99) break;               
                //---
                
                rayPosPrev = rayPosCurr;
                
            }
            gl_FragColor = vec4(colAcc, alphaAcc);
            }
        `;
    }
}