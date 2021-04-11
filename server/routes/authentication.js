const jwt = require("jsonwebtoken")
const User = require('../models/User')
const { compareHash } = require("../Utility/hashing")
const mongoose = require('mongoose')
const { Router } = require('express')
const me = require('mongo-escape').escape
const escapeStringRegexp = require('escape-string-regexp')


const router = Router()
/*
    Expected fields in token:
    exp - expire time
    userid - to lookup userinfo and rights (or none if judge)
    role - f.ex. admin, researcher, judge
*/
/**
 * @apiDefine AuthMiddleware
 * @apiError (401) 401 Unauthorized, You do not have the access-token required to access this resource
 * @apiError (403) 403 Forbidden, you are authenticated but lack authorization to access this resource
 */
const auth = (req, res, next) => {
    if (!req.headers.cookie) {
        console.log("auth, no req.headers.cookie")
        res.sendStatus(401)
        return
    }
    const cookies = req.cookies

    if (!cookies["access-token"] && !cookies["judge-token"]) {
        console.log("cookies", cookies)
        res.sendStatus(401)
        return
    }
    else{
        req.auth = []
        if (cookies["judge-token"]) {
            console.log("secret:", cookies["judge-token"], typeof cookies["judge-token"])
            jwt.verify(cookies["judge-token"], process.env.JWTJudgeSecret, (err, decoded) => {
                if (err) {
                    console.log("Judge verify error in auth:",err)
                    res.sendStatus(401)
                }
                else {
                    //Set the potentially required feilds contained in the token to the request
                    req.auth["judge"] = {userid: decoded.userid, role: decoded.role}
                    //req.userid = decoded.userid
                    //req.role = decoded.role
                }
            })
        }
        if (cookies["access-token"]) {
            jwt.verify(cookies["access-token"], process.env.JWTSecret, (err, decoded) => {
                if (err) {
                    console.log(err)
                    res.sendStatus(401)
                }
                else {
                    //Set the potentially required feilds contained in the token to the request
                    req.auth["user"] = {userid: decoded.userid, role: decoded.role}
                    //req.userid = decoded.userid
                    //req.role = decoded.role
                }
            })
        }
        if(req.auth === []){
            res.sendStatus(401)
        }
        else{
            next()
        }
    }
}

router.get("/logout", async (req, res) => {
    res.set({
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
    })
    res.cookie("access-token", {}, { httpOnly: true, maxAge: 0, sameSite: "lax" })
    res.sendStatus(200)
    return;
})

router.get("/logout/judge", async (req, res) => {
    res.set({
        "Cache-Control": "no-cache",
        "Pragma": "no-cache"
    })
    res.cookie("judge-token", {}, { httpOnly: true, maxAge: 0, sameSite: "lax" })
    res.sendStatus(200)
    return;
})

router.post("/login", async (req, res) => {
    console.log("Called get /login")
    console.log("login body: ", req.body)
    const { email, password } = req.body
    try {
        if (email && password) {
            const userDoc = await User.findOne({ email: {$eq: email} })
            if (userDoc) {
                console.log("Found user with email: ", email)
                if (compareHash(userDoc.hashed, password, userDoc.salt)) {
                    console.log("authenticated successfully")
                    const now = new Date(Date.now())
                    const exp = new Date(now)
                    exp.setMinutes(exp.getMinutes() + 30)
                    const expSeconds = Math.floor(exp.getTime() / 1000)
                    console.log("JWT Expires in seconds: ", expSeconds)
                    const token = jwt.sign(
                        {
                            exp: expSeconds,
                            userid: userDoc._id,
                            role: userDoc.role
                        },
                        process.env.JWTSecret
                    )
                    res.set({
                        "Cache-Control": "no-cache",
                        "Pragma": "no-cache"
                    })
                    let expMillis = exp.getTime() - now.getTime(); //Cookie max age converts milliseconds from creation into expires at DateTime
                    res.cookie("access-token", token, { httpOnly: true, maxAge: expMillis, sameSite: "lax" })
                    res.status(200).json({ email: email, userid: userDoc._id, role: userDoc.role })
                    return;
                }
            }
        }
        res.status(401).json({message: "Incorrect username or password"})
    } catch (error) {
        console.log("Error: ", error)
        res.sendStatus(500).json({message: "Internal Server Error"})
    }
})

router.post("/refresh-token", async (req, res) => {
    console.log("Called post /refresh-token")
    if (!req.headers.cookie) {
        res.sendStatus(401)
        console.log("Sent status 401 because no cookies");
        return
    }
    const cookies = req.cookies
    if (!cookies["access-token"]) {
        res.sendStatus(401)
        console.log("Sent status 401 because no cookies #2");
        return
    }
    if(cookies["access-token"]) {
        jwt.verify(cookies["access-token"], process.env.JWTSecret, async (err, decoded) => {
            if (err) {
                console.log(err)
                res.sendStatus(401);
                console.log("Sent status 401 couldnt verify");
                return
            }
            else {
                const userDoc = await User.findOne({ _id: decoded.userid })
                if (!userDoc) {
                    res.sendStatus(401)
                    console.log("Sent status 401 because no userDoc");
                    return
                }
                const now = new Date(Date.now())
                const exp = new Date(now)
                exp.setMinutes(exp.getMinutes() + 30)
                const expSeconds = Math.floor(exp.getTime() / 1000)
                const newToken = jwt.sign(
                    {
                        exp: expSeconds,
                        userid: decoded.userid,
                        role: decoded.role
                    },
                    process.env.JWTSecret
                )
                res.set({
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                })
                let expMillis = exp.getTime() - now.getTime(); //Cookie max age converts milliseconds from creation into expires at DateTime
                res.cookie("access-token", newToken, { httpOnly: true, maxAge: expMillis, sameSite: "lax" })
                res.status(200).json({ email: userDoc.email, userid: decoded.userid, role: decoded.role })
                return
            }
        })
    }
    else{
        res.sendStatus(401);
        return
    }   
})

router.post("/refresh-judge-token", async (req, res) => {
    const cookies = req.cookies
    if (cookies["judge-token"]) {
        console.log("Judge token found")
        jwt.verify(cookies["judge-token"], process.env.JWTJudgeSecret, async (err, decoded) => {
            if (err) {
                console.log(err)
                res.status(401).json({ error: "Not authorized." })
                return
            }
            else {
                const now = new Date(Date.now())
                const exp = new Date(now)
                exp.setMinutes(exp.getMinutes() + 30)
                const expSeconds = Math.floor(exp.getTime() / 1000)
                const newToken = jwt.sign(
                    {
                        exp: expSeconds,
                        userid: decoded.userid,
                        role: decoded.role
                    },
                    process.env.JWTJudgeSecret
                )
                res.set({
                    "Cache-Control": "no-cache",
                    "Pragma": "no-cache"
                })
                let expMillis = exp.getTime() - now.getTime(); //Cookie max age converts milliseconds from creation into expires at DateTime
                res.cookie("judge-token", newToken, { httpOnly: true, maxAge: expMillis, sameSite: "lax" })
                res.status(200).json({ email: decoded.email, userid: decoded.userid, role: decoded.role })
                return;
            }
        })
    }
    else{
        res.sendStatus(401);
        return
    }
})

router.post("/login/judge", async (req, res) => {
    console.log("Called get /login/judge")
    const { requestedSurveyID } = req.body
    try {
        //TODO actually use requestedSurveyID :)
        if (requestedSurveyID) {
            const now = new Date(Date.now())
            const exp = new Date(now)
            exp.setMinutes(exp.getMinutes() + 30)
            const expSeconds = Math.floor(exp.getTime() / 1000)
            console.log("JWT Expires in seconds: ", expSeconds)
            const userId = new mongoose.mongo.ObjectId()
            const token = jwt.sign(
                {
                    exp: expSeconds,
                    userid: userId, //judge ID, used for SurveyAnswer
                    role: "judge"
                },
                process.env.JWTJudgeSecret
            )
            res.set({
                "Cache-Control": "no-cache",
                "Pragma": "no-cache"
            })
            let expMillis = exp.getTime() - now.getTime(); //Cookie max age converts milliseconds from creation into expires at DateTime
            res.cookie("judge-token", token, { httpOnly: true, maxAge: expMillis, sameSite: "lax" })
            res.json({ email: null, userid: userId, role: "judge" })
            return;
        }
        throw new Error("Email or password not provided.")
    } catch (error) {
        console.log("Error: ", error)
        res.sendStatus(401)
    }
})
module.exports = { router, auth }