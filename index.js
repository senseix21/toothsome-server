const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const stripe = require("stripe")('sk_test_51Mt2qzDy7i8zUt3dPcj0MC0ZBolHDNhtvv2Lj0xPujEcHyWPyItGy8Nln2LZunlKEpqRhmzM88ZU9E3hnXcCNjQ100oso9Aycy');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const port = process.env.PORT || 5000;
const app = express();

//middlewares
app.use(cors());
app.use(express.json());
// console.log(stripe)
console.log(process.env.STRIPE_SECRET_KEY)



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASSWORD}@cluster1.bhuozyz.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

const verifyJwt = (req, res, next) => {
    const authHeader = req.headers.authorization;
    console.log('suthhEADER', authHeader)
    if (!authHeader) {
        return res.status(401).send({ message: 'Invalid authorization header ' })
    }
    const token = authHeader.split(' ')[1];

    jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
        if (err) {
            return res.status(403).send({ message: 'Forbidden Access' })
        }
        req.decoded = decoded;
        next(err);
    })
}

const run = async () => {
    try {
        const bookingsCollection = client.db('toothSomeDB').collection('appointment');
        const appointmentOptionCollection = client.db('toothSomeDB').collection('appointmentOptions')
        const usersCollection = client.db('toothSomeDB').collection('users')
        const doctorsCollection = client.db('toothSomeDB').collection('doctors')
        const paymentsCollection = client.db('toothSomeDB').collection('payments')

        //verify Admin role exists
        const verifyAdmin = async (req, res, next) => {
            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail }
            const user = await usersCollection.findOne(query)
            if (decodedEmail !== user.email) {
                return res.status(403).send({ message: 'Forbidden Access' });
            }
            req.decoded.email = decodedEmail
            next();
        }

        //Verify JWT Token
        app.get('/jwt', async (req, res) => {
            const email = req.query.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            console.log(user);
            if (user) {
                const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1d' });
                return res.send({ accessToken: token });
            }
            return res.status(403).send({ accessToken: '' }); //)
        })



        app.get('/appointmentOptions', async (req, res) => {
            const query = {};
            const cursor = appointmentOptionCollection.find(query);
            const appointmentOptions = await cursor.toArray();

            const date = req.query.date;
            console.log(date);
            const appointmentQuery = { date: date }
            const booked = await bookingsCollection.find(appointmentQuery).toArray();

            appointmentOptions.forEach(option => {
                const optionBooked = booked.filter(book => book.treatment === option.name)
                const bookedSlots = optionBooked.map(book => book.slot)
                const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
                option.slots = remainingSlots;
                // console.log(date, option.name, remainingSlots);
            })

            res.send(appointmentOptions);
        });

        app.get('/v2/appointmentOptions', async (req, res) => {
            const date = req.query.date;
            console.log(date);
            const options = await appointmentOptionCollection.aggregate([
                {
                    $lookup: {
                        from: 'appointment',
                        localField: 'name',
                        foreignField: 'treatment',
                        pipeline: [
                            {
                                $match: {
                                    $expr: {
                                        $eq: ['$appointmentDate', date]
                                    }
                                }
                            }
                        ],
                        as: 'booked'
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: 1,
                        booked: {
                            $map: {
                                input: '$booked',
                                as: 'book',
                                in: '$$book.slot'
                            }
                        }
                    }
                },
                {
                    $project: {
                        name: 1,
                        slots: {
                            $setDifference: ['$slots', '$booked']
                        }
                    }
                }
            ]).toArray();
            res.send(options);
        });

        app.get('/appointmentSpeciality', async (req, res) => {
            const query = {}
            const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
            res.send(result);
        });

        app.get('/appointment', verifyJwt, async (req, res) => {
            const email = req.query.email;
            const decodedEmail = req.decoded.email;
            console.log(decodedEmail);

            if (email !== decodedEmail) {
                return res.status(403).send({ message: 'Unauthorized', })
            }
            let query = { email }
            // console.log(query);
            const cursor = bookingsCollection.find(query);
            const appointments = await cursor.toArray();
            res.send(appointments);
        });

        app.get('/appointment/:id', async (req, res) => {
            const id = req.params.id;
            const query = { _id: new ObjectId(id) };
            const result = await bookingsCollection.findOne(query);
            res.send(result);
        });

        app.post('/appointment', async (req, res) => {
            const appointment = req.body;
            const query = {
                date: appointment.date,
            }
            console.log(query)
            const alreadyBooked = await bookingsCollection.find(query).toArray();
            if (alreadyBooked.length) {
                const message = `You already have a booking on ${appointment.date}`;
                return res.send({ acknowledged: false, message });

            }
            const result = await bookingsCollection.insertOne(appointment);
            res.send(result);
        });

        app.post('/users', async (req, res) => {
            const users = req.body;
            const query = { email: users.email }
            const alreadyRegistered = await usersCollection.find(query).toArray();
            if (alreadyRegistered.length > 0) {
                const message = `Already registered with ${users.email} `
                return res.send({ acknowledged: false, message: message })
            }
            const result = await usersCollection.insertOne(users);
            res.send(result); //

        });

        app.get('/users', async (req, res) => {
            const query = {};
            const users = await usersCollection.find(query).toArray();
            res.send(users);

        });

        app.get('/users/admin/:email', async (req, res) => {
            const email = req.params.email;
            const query = { email: email };
            const user = await usersCollection.findOne(query);
            res.send({ isAdmin: user?.role === 'admin' });
        })


        //Update user role 
        app.put('/users/admin/:id', verifyJwt, async (req, res) => {
            // console.log('head', email)

            const decodedEmail = req.decoded.email;
            const query = { email: decodedEmail };
            const user = await usersCollection.findOne(query);
            if (user?.role !== 'admin') {
                return res.status(401).send({ message: 'Invalid credentials' });
            }

            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const option = { upsert: true };
            const updatedDoc = {
                $set: {
                    role: 'admin',
                }
            }
            const result = await usersCollection.updateOne(filter, updatedDoc, option);
            res.send(result);
        });

        /*  //Add price 
         app.get('/addprice', async (req, res) => {
             const filter = {};
             const option = { upsert: true };
             const updatedDoc = {
                 $set: {
                     price: 99,
                 }
             }
             const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, option);
             res.send(result);
         }) */

        //delete a user from db
        app.get('/users/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const user = await usersCollection.findOne(filter);
            res.send(user);
        })
        app.delete('/users/:id', async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const user = await usersCollection.deleteOne(filter);
            res.send(user);
        });


        //
        app.get('/dashboard/doctors', verifyJwt, verifyAdmin, async (req, res) => {
            const query = {};
            const doctors = await doctorsCollection.find(query).toArray();
            res.send(doctors);
        });

        app.post('/dashboard/doctors', verifyJwt, async (req, res) => {
            const doctors = req.body;
            const query = { email: doctors.email };
            const alreadyAdded = await doctorsCollection.find(query).toArray();
            if (alreadyAdded.length > 0) {
                return res.status(401).send({ acknowledged: false, message: 'Already added' });
            }
            const result = await doctorsCollection.insertOne(doctors);
            res.send(result);
        });

        app.delete('/dashboard/doctors/:id', verifyJwt, async (req, res) => {
            const id = req.params.id;
            const filter = { _id: new ObjectId(id) };
            const doctor = await doctorsCollection.deleteOne(filter)
            res.send(doctor);
        });


        //Payment Gateway intergration
        app.post('/create-payment-intent', async (req, res) => {
            const appointment = req.body;
            const price = appointment.price;
            const amount = price * 100;
            console.log(amount);

            // Create a PaymentIntent with the order amount and currency
            const paymentIntent = await stripe.paymentIntents.create({
                currency: 'usd',
                amount: amount,
                "payment_method_types": [
                    "card"
                ]
            });
            res.send({
                clientSecret: paymentIntent.client_secret,
            });
        });

        //PaymentCollection db setup
        app.get('/payments', async (req, res) => {
            const query = {};
            const payments = await paymentsCollection.find(query).toArray();

            res.send(payments);
        })

        app.post('/payments', async (req, res) => {
            const payment = req.body;
            const result = await paymentsCollection.insertOne(payment);

            const id = payment.bookingId;
            console.log(id);
            const filter = { _id: new ObjectId(id) };
            const updatedDoc = {
                $set: {
                    paid: true,
                    transactionId: payment.transactionId,
                }
            }
            const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
            console.log(updatedResult);

            res.send(result);
        })

    }
    finally {

    }
}
run().catch(error => console.error(error));



//server
app.get('/', async (req, res) => {
    res.send('Welcome to toothsomeness server!');
});

app.listen(port, () => {
    console.log('listening on port ' + port)
});


